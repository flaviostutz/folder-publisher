/* eslint-disable no-console */
import fs, { existsSync } from 'node:fs';
import path from 'node:path';

import {
  NpmdataExtractEntry,
  ManagedFileMetadata,
  NpmdataConfig,
  ProgressEvent,
  BasicPackageOptions,
} from '../types';
import { parsePackageSpec, filterEntriesByPresets, getInstalledIfSatisfies } from '../utils';
import { readOutputDirMarker } from '../fileset/markers';
import { purgeFileset } from '../fileset/purge';

export type PurgeOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
  visitedPackages?: Set<string>;
  config?: NpmdataConfig;
  presets?: string[];
};

export type PurgeSummary = {
  deleted: number;
  symlinksRemoved: number;
  dirsRemoved: number;
};

/** Maps absolute outputDir path → managed file entries to purge for that directory. */
type PurgePlan = Map<string, ManagedFileMetadata[]>;

/**
 * Phase 1: recursively collect all managed file entries that need to be purged,
 * grouped by output directory. No disk writes are performed.
 */
// eslint-disable-next-line complexity
async function collectPurgePlan(
  entries: NpmdataExtractEntry[],
  cwd: string,
  verbose: boolean,
  visitedPackages: Set<string>,
  plan: PurgePlan,
  onProgress?: (event: ProgressEvent) => void,
): Promise<void> {
  if (verbose) {
    console.log(
      `[verbose] purge: collecting ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  for (const entry of entries) {
    const pkg = parsePackageSpec(entry.package);
    const outputDir = path.resolve(cwd, entry.output?.path ?? '.');

    if (verbose) {
      console.log(
        `[verbose] purge: collecting entry package=${entry.package} outputDir=${entry.output?.path ?? '.'}`,
      );
    }

    onProgress?.({
      type: 'package-start',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Read the marker and collect only entries belonging to this package
    const managedFiles = await readOutputDirMarker(outputDir);
    const entryFiles = managedFiles.filter((m) => m.packageName === pkg.name);

    // Accumulate into the plan (multiple entries may share the same outputDir)
    const existing = plan.get(outputDir) ?? [];
    plan.set(outputDir, [...existing, ...entryFiles]);

    onProgress?.({
      type: 'package-end',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Hierarchical collection: if the installed package declares npmdata.sets, recurse
    const pkgPath = getInstalledIfSatisfies(pkg.name, pkg.version, cwd);
    if (!pkgPath) continue;

    const pkgJsonFile = path.join(pkgPath, 'package.json');
    if (!existsSync(pkgJsonFile)) continue;

    const depPkgJson = JSON.parse(fs.readFileSync(pkgJsonFile).toString()) as {
      npmdata?: { sets?: NpmdataExtractEntry[] };
    };
    const pkgNpmdataSets = depPkgJson.npmdata?.sets;

    if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
      const siblingNames = new Set(entries.map((e) => parsePackageSpec(e.package).name));
      const presetFilteredSets = filterEntriesByPresets(
        pkgNpmdataSets,
        entry.selector?.presets ?? [],
      );

      // Self-referencing sets (same package + explicit files) define which of the current
      // package's own files belong to each preset. Include them alongside external sets so
      // that --presets filtering works correctly for self-installable packages.
      const selfRefSets =
        entry.selector?.presets && entry.selector.presets.length > 0
          ? presetFilteredSets.filter(
              (e) =>
                parsePackageSpec(e.package).name === pkg.name &&
                e.selector?.files &&
                e.selector.files.length > 0,
            )
          : [];

      const externalSets = presetFilteredSets.filter(
        (e) =>
          !siblingNames.has(parsePackageSpec(e.package).name) &&
          !visitedPackages.has(parsePackageSpec(e.package).name),
      );

      const filteredSets = [...selfRefSets, ...externalSets];

      if (filteredSets.length > 0) {
        const visitedSet = new Set(visitedPackages);
        visitedSet.add(pkg.name);

        const outputConfig = entry.output ?? {};
        const inheritedEntries = filteredSets.map((depEntry) => {
          const { path: depPath, ...restOutput } = depEntry.output ?? {};
          return {
            ...depEntry,
            output: {
              ...restOutput,
              path: path.join(outputConfig.path ?? '.', depPath ?? '.'),
            },
          };
        });

        if (verbose) {
          console.log(
            `[verbose] purge: recursing into ${filteredSets.length} set(s) from ${pkg.name} (${selfRefSets.length} self-ref, ${externalSets.length} external)`,
          );
        }

        await collectPurgePlan(inheritedEntries, cwd, verbose, visitedSet, plan, onProgress);
      }
    }
  }
}

/**
 * Purge managed files from all matching filesets.
 * Supports --dry-run.
 *
 * Operates in two phases:
 *   1. Collect: recursively traverse all sets and accumulate the managed file
 *      entries to delete per output directory (no disk writes).
 *   2. Execute: delete the collected files per output directory, then update
 *      the marker (removing only purged paths) and gitignore accordingly.
 */
export async function actionPurge(options: PurgeOptions): Promise<PurgeSummary> {
  const {
    entries,
    cwd,
    dryRun = false,
    verbose = false,
    onProgress,
    visitedPackages = new Set<string>(),
  } = options;

  // Phase 1: collect all entries to purge across all recursive sets
  if (verbose) {
    console.log(`[verbose] purge: phase 1 - collecting entries to purge (cwd: ${cwd})`);
  }

  const plan: PurgePlan = new Map();
  await collectPurgePlan(entries, cwd, verbose, visitedPackages, plan, onProgress);

  const summary: PurgeSummary = { deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 };

  // Phase 2: execute deletions per output directory
  if (verbose) {
    const total = [...plan.values()].reduce((sum, e) => sum + e.length, 0);
    console.log(
      `[verbose] purge: phase 2 - deleting ${total} entr${total === 1 ? 'y' : 'ies'} across ${plan.size} output dir(s)`,
    );
  }

  for (const [outputDir, entriesToPurge] of plan) {
    if (verbose) {
      console.log(
        `[verbose] purge: executing purge for ${path.relative(cwd, outputDir)} (${entriesToPurge.length} entries)`,
      );
    }

    const result = await purgeFileset(outputDir, entriesToPurge, dryRun);

    for (const m of entriesToPurge) {
      onProgress?.({ type: 'file-deleted', packageName: m.packageName, file: m.path });
    }

    summary.deleted += result.deleted;
    summary.symlinksRemoved += result.symlinksRemoved;
    summary.dirsRemoved += result.dirsRemoved;

    if (verbose) {
      console.log(
        `[verbose] purge: deleted ${result.deleted} files, ${result.symlinksRemoved} symlinks, ${result.dirsRemoved} dirs`,
      );
    }
  }

  return summary;
}
