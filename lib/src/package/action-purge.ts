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
  visitedEntries?: Set<string>;
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

/** Unique key for a set entry: same package with different selectors is a distinct entry. */
const entryKey = (entry: NpmdataExtractEntry): string =>
  `${parsePackageSpec(entry.package).name}|${JSON.stringify(entry.selector ?? {})}`;

/**
 * Phase 1: recursively collect all managed file entries that need to be purged,
 * grouped by output directory. No disk writes are performed.
 */
// eslint-disable-next-line complexity
async function collectPurgePlan(
  entries: NpmdataExtractEntry[],
  cwd: string,
  verbose: boolean,
  visitedEntries: Set<string>,
  plan: PurgePlan,
  onProgress?: (event: ProgressEvent) => void,
): Promise<void> {
  // Skip already-visited entries to break recursion cycles; mark the rest as visited.
  const entriesToProcess = entries.filter((entry) => !visitedEntries.has(entryKey(entry)));
  for (const entry of entriesToProcess) {
    visitedEntries.add(entryKey(entry));
  }

  if (verbose) {
    console.log(
      `[verbose] purge: collecting ${entriesToProcess.length} entr${entriesToProcess.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  for (const entry of entriesToProcess) {
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
      const presetFilteredSets = filterEntriesByPresets(
        pkgNpmdataSets,
        entry.selector?.presets ?? [],
      );

      // Preemptively mark preset-excluded entries as visited so they cannot sneak
      // back in through a self-referencing set's secondary recursion.
      for (const e of pkgNpmdataSets) {
        if (!presetFilteredSets.includes(e)) {
          visitedEntries.add(entryKey(e));
        }
      }

      // Self-referencing sets only recurse when presets are active; external sets always recurse.
      const filteredSets = presetFilteredSets.filter(
        (e) =>
          parsePackageSpec(e.package).name !== pkg.name ||
          (entry.selector?.presets?.length ?? 0) > 0,
      );

      if (filteredSets.length > 0) {
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
            `[verbose] purge: recursing into ${filteredSets.length} set(s) from ${pkg.name}`,
          );
        }

        await collectPurgePlan(inheritedEntries, cwd, verbose, visitedEntries, plan, onProgress);
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
    visitedEntries = new Set<string>(),
  } = options;

  // Phase 1: collect all entries to purge across all recursive sets
  if (verbose) {
    console.log(`[verbose] purge: phase 1 - collecting entries to purge (cwd: ${cwd})`);
  }

  const plan: PurgePlan = new Map();
  await collectPurgePlan(entries, cwd, verbose, visitedEntries, plan, onProgress);

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
