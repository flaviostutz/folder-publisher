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
  visitedPackages?: Set<string>;
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
// eslint-disable-next-line complexity
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const {
    entries,
    cwd,
    verbose = false,
    onProgress,
    visitedPackages = new Set<string>(),
  } = options;
  const summary: CheckSummary = { missing: [], modified: [], extra: [] };

  if (verbose) {
    console.log(
      `[verbose] check: verifying ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  for (const entry of entries) {
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
        const siblingNames = new Set(entries.map((e) => parsePackageSpec(e.package).name));
        const presetFilteredSets = filterEntriesByPresets(pkgNpmdataSets, entry.selector?.presets);

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
              `[verbose] check: recursing into ${filteredSets.length} set(s) from ${pkg.name} (${selfRefSets.length} self-ref, ${externalSets.length} external)`,
            );
          }

          const subResult = await actionCheck({
            entries: inheritedEntries,
            cwd,
            verbose,
            onProgress,
            visitedPackages: visitedSet,
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
