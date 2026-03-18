/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { BasicPackageOptions, NpmdataExtractEntry, ProgressEvent } from '../types';
import {
  parsePackageSpec,
  getInstalledPackagePath,
  getInstalledIfSatisfies,
  filterEntriesByPresets,
} from '../utils';
import { readOutputDirMarker } from '../fileset/markers';
import { checkFileset } from '../fileset/check';

export type CheckOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
  visitedEntries?: Set<string>;
};

export type CheckSummary = {
  missing: string[];
  modified: string[];
  extra: string[];
};

/**
 * Orchestrate check across all filesets, filtering out entries with managed=false.
 * Returns a summary of all drift found across all entries.
 */
/** Unique key for a set entry: same package with different selectors is a distinct entry. */
const entryKey = (entry: NpmdataExtractEntry): string =>
  `${parsePackageSpec(entry.package).name}|${JSON.stringify(entry.selector ?? {})}`;

// eslint-disable-next-line complexity
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const { entries, cwd, verbose = false, onProgress, visitedEntries = new Set<string>() } = options;
  const summary: CheckSummary = { missing: [], modified: [], extra: [] };

  // Skip already-visited entries to break recursion cycles; mark the rest as visited.
  const entriesToProcess = entries.filter((entry) => !visitedEntries.has(entryKey(entry)));
  for (const entry of entriesToProcess) {
    visitedEntries.add(entryKey(entry));
  }

  if (verbose) {
    console.log(
      `[verbose] check: verifying ${entriesToProcess.length} entr${entriesToProcess.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  for (const entry of entriesToProcess) {
    // Skip entries with managed=false — they write no marker so there is nothing to check.
    // The --managed=false flag also suppresses checking for explicitly marked entries.
    if (entry.output?.managed === false) continue;

    const pkg = parsePackageSpec(entry.package);
    const outputDir = path.resolve(cwd, entry.output?.path ?? '.');

    if (verbose) {
      console.log(
        `[verbose] check: checking package=${entry.package} outputDir=${entry.output?.path ?? '.'}`,
      );
    }

    onProgress?.({
      type: 'package-start',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Check if package is installed
    const pkgPath = getInstalledPackagePath(pkg.name, cwd);

    // Read existing marker and filter to entries owned by this package only.
    // Multiple packages may share the same outputDir; passing the full marker to
    // checkFileset would cause files owned by other packages to be checked against
    // the current package's source, producing false positives.
    const existingMarker = await readOutputDirMarker(outputDir);
    const pkgMarker = existingMarker.filter((m) => m.packageName === pkg.name);

    if (!pkgPath) {
      console.error(`Package ${pkg.name} is not installed. Run 'extract' first.`);
      summary.missing.push(...pkgMarker.map((m) => m.path));
      continue;
    }

    const result = await checkFileset(
      pkgPath,
      outputDir,
      entry.selector ?? {},
      entry.output ?? {},
      pkgMarker,
    );

    summary.missing.push(...result.missing);
    summary.modified.push(...result.modified);
    summary.extra.push(...result.extra);

    onProgress?.({
      type: 'package-end',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Hierarchical check: if the installed package declares npmdata.sets, recurse into them
    const installedPkgPath = getInstalledIfSatisfies(pkg.name, pkg.version, cwd);
    if (installedPkgPath) {
      let pkgNpmdataSets: NpmdataExtractEntry[] | undefined;
      try {
        const depPkgJson = JSON.parse(
          fs.readFileSync(path.join(installedPkgPath, 'package.json')).toString(),
        ) as { npmdata?: { sets?: NpmdataExtractEntry[] } };
        pkgNpmdataSets = depPkgJson.npmdata?.sets;
      } catch (error) {
        if (verbose) {
          console.warn(
            `[verbose] check: could not read npmdata.sets from ${pkg.name}/package.json: ${error}`,
          );
        }
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        const presetFilteredSets = filterEntriesByPresets(pkgNpmdataSets, entry.selector?.presets);

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
              `[verbose] check: recursing into ${filteredSets.length} set(s) from ${pkg.name}`,
            );
          }

          const subResult = await actionCheck({
            entries: inheritedEntries,
            cwd,
            verbose,
            onProgress,
            visitedEntries,
          });
          summary.missing.push(...subResult.missing);
          summary.modified.push(...subResult.modified);
          summary.extra.push(...subResult.extra);
        }
      }
    }
  }

  return summary;
}
