/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { NpmdataExtractEntry, ProgressEvent, BasicPackageOptions } from '../types';
import {
  parsePackageSpec,
  installOrUpgradePackage,
  getInstalledIfSatisfies,
  cleanupTempPackageJson,
  filterEntriesByPresets,
} from '../utils';
import { diff } from '../fileset/diff';
import { execute, rollback, deleteFiles } from '../fileset/execute';
import { readOutputDirMarker } from '../fileset/markers';
import { matchesFilePatterns } from '../fileset/package-files';

import { createSymlinks, removeStaleSymlinks } from './symlinks';

export type ExtractOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
  visitedPackages?: Set<string>;
  /** Pre-installed package paths (name → absolute path). Used to route self-referencing
   * nested sets through the normal recursion without reinstalling or tripping the
   * circular-dependency guard. */
  installedPkgPaths?: Map<string, string>;
};

export type ExtractResult = {
  added: number;
  modified: number;
  deleted: number;
  skipped: number;
};

/**
 * Orchestrate full extract across all filesets.
 * Implements the two-phase diff+execute model with conflict detection and rollback.
 */
// eslint-disable-next-line complexity
export async function actionExtract(options: ExtractOptions): Promise<ExtractResult> {
  const {
    entries,
    cwd,
    verbose,
    onProgress,
    visitedPackages = new Set<string>(),
    installedPkgPaths,
  } = options;

  if (verbose) {
    console.log(
      `[verbose] >>> EXTRACT - ${entries.reduce((acc, entry) => acc + entry.package + ', ', '').slice(0, -2)}`,
    );
  }

  const result: ExtractResult = { added: 0, modified: 0, deleted: 0, skipped: 0 };
  const allNewlyCreated: string[] = [];
  const deferredDeletes: string[] = [];

  try {
    for (const entry of entries) {
      if (verbose) {
        // eslint-disable-next-line no-undefined
        console.log(`[verbose] entry: ${JSON.stringify(entry, undefined, 2)}`);
      }

      if (!entry.package) {
        throw new Error('Each set entry must have a "package" field.');
      }
      const pkg = parsePackageSpec(entry.package);

      // Circular dependency detection. Pre-installed packages (self-referencing sets passed
      // via installedPkgPaths) are exempt — they are already resolved, not truly circular.
      if (visitedPackages.has(pkg.name) && !installedPkgPaths?.has(pkg.name)) {
        throw new Error(
          `Circular dependency detected: package "${pkg.name}" is already being extracted`,
        );
      }

      const outputDir = path.resolve(cwd, entry.output?.path ?? '.');
      const selector = entry.selector ?? {};
      const outputConfig = entry.output ?? {};
      const contentReplacements = outputConfig.contentReplacements ?? [];

      onProgress?.({
        type: 'package-start',
        packageName: pkg.name,
        packageVersion: pkg.version ?? 'latest',
      });

      // Phase 1: Install package (or reuse pre-installed path for self-referencing sets)
      const upgrade = selector.upgrade ?? false;
      const alreadyCached =
        !upgrade &&
        (installedPkgPaths?.has(pkg.name) ||
          getInstalledIfSatisfies(pkg.name, pkg.version, cwd) !== null);
      const pkgPath =
        installedPkgPaths?.get(pkg.name) ??
        (await installOrUpgradePackage(pkg.name, pkg.version, upgrade, cwd, verbose));

      if (verbose) {
        let status = 'installed';
        if (alreadyCached) status = 'using cached';
        else if (upgrade) status = 'upgraded';
        console.log(`[verbose] (${status}) package ${pkg.name} at ${pkgPath}`);
      }

      // Get installed version
      let installedVersion = '0.0.0';
      try {
        const pkgJsonContent = JSON.parse(
          fs.readFileSync(path.join(pkgPath, 'package.json')).toString(),
        ) as {
          version: string;
        };
        installedVersion = pkgJsonContent.version;
      } catch (error) {
        // fallback
        if (verbose) {
          console.warn(
            `[verbose] extract: could not read version from ${pkg.name}/package.json, defaulting to 0.0.0: ${error}`,
          );
        }
      }

      // Remove stale symlinks before diff
      if (outputConfig.symlinks && outputConfig.symlinks.length > 0) {
        if (verbose) {
          console.log(`[verbose] extract: removing stale symlinks in ${outputDir}`);
        }
        await removeStaleSymlinks(outputDir, outputConfig.symlinks);
      }

      // Phase 2: Read existing marker (all packages combined)
      if (verbose) {
        console.log(`[verbose] extract: reading existing output marker from ${outputDir}`);
      }
      const existingMarker = await readOutputDirMarker(outputDir);

      // Filter to current package only so diff's toDelete logic doesn't purge
      // files managed by other packages writing to the same output directory.
      // Also filter by the current entry's selector patterns so that sibling
      // sets for the same package don't schedule each other's files for deletion.
      const pkgMarker = existingMarker.filter(
        (m) =>
          m.packageName === pkg.name &&
          // eslint-disable-next-line no-undefined
          (selector.files === undefined ||
            selector.files.length === 0 ||
            matchesFilePatterns(m.path, selector.files)),
      );
      if (verbose) {
        console.log(
          `[verbose] extract: marker has ${existingMarker.length} total entries, ${pkgMarker.length} for ${pkg.name}`,
        );
      }

      // Phase 3: Diff phase (pure, no disk writes)
      if (verbose) {
        console.log(
          `[verbose] extract: Diffing package files from ${pkgPath} to ${outputDir} with selector ${JSON.stringify(selector)} and outputConfig ${JSON.stringify(outputConfig)}`,
        );
      }
      const extractionMap = await diff(
        pkgPath,
        outputDir,
        selector,
        outputConfig,
        pkgMarker,
        contentReplacements,
      );

      // Phase 4: Abort on conflicts (unless force or managed=false)
      if (
        extractionMap.conflicts.length > 0 &&
        !outputConfig.force &&
        outputConfig.managed !== false
      ) {
        const conflictPaths = extractionMap.conflicts.map((c) => c.relPath).join('\n');
        if (verbose) {
          console.warn(
            `[verbose] extract: aborting due to ${extractionMap.conflicts.length} conflict(s) in ${outputDir}: ${conflictPaths}`,
          );
        }
        throw new Error(
          `Conflict: the following files exist and are not managed by npmdata:\n${conflictPaths}\n` +
            `Use --force to overwrite or --managed=false to skip.`,
        );
      }

      // Phase 5: Execute phase (disk writes)

      if (verbose) {
        console.log(
          `[verbose] extract: diff result for ${pkg.name}: +${extractionMap.toAdd.length} ~${extractionMap.toModify.length} -${extractionMap.toDelete.length} skip=${extractionMap.toSkip.length} conflicts=${extractionMap.conflicts.length}`,
        );
        console.log(`[verbose] extract: executing disk writes for ${pkg.name} in ${outputDir}`);
      }

      const executeResult = await execute(
        extractionMap,
        outputDir,
        outputConfig,
        pkg,
        installedVersion,
        existingMarker,
        cwd,
        verbose,
      );

      // Collect newly created files for potential rollback
      allNewlyCreated.push(...executeResult.newlyCreated);

      // Collect deferred deletes (execute across all filesets first)
      for (const relPath of extractionMap.toDelete) {
        deferredDeletes.push(path.join(outputDir, relPath));
      }

      // Emit progress events
      for (const op of extractionMap.toAdd) {
        onProgress?.({ type: 'file-added', packageName: pkg.name, file: op.relPath });
      }
      for (const op of extractionMap.toModify) {
        onProgress?.({ type: 'file-modified', packageName: pkg.name, file: op.relPath });
      }
      for (const relPath of extractionMap.toDelete) {
        onProgress?.({ type: 'file-deleted', packageName: pkg.name, file: relPath });
      }
      for (const skipped of extractionMap.toSkip) {
        onProgress?.({ type: 'file-skipped', packageName: pkg.name, file: skipped.relPath });
      }

      result.added += executeResult.added;
      result.modified += executeResult.modified;
      result.skipped += executeResult.skipped;

      // Handle recursive resolution: check if installed package has npmdata.sets
      let pkgNpmdataSets: NpmdataExtractEntry[] | undefined;
      try {
        const depPkgJson = JSON.parse(
          fs.readFileSync(path.join(pkgPath, 'package.json')).toString(),
        ) as {
          npmdata?: { sets?: NpmdataExtractEntry[] };
        };
        pkgNpmdataSets = depPkgJson.npmdata?.sets;
      } catch (error) {
        // No package.json or no npmdata.sets
        if (verbose) {
          console.warn(
            `[verbose] extract: could not read npmdata.sets from ${pkg.name}/package.json: ${error}`,
          );
        }
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        // Names of packages already being processed at this level (siblings).
        // Skip recursive resolution for any set entry that is already a sibling — those
        // will be (or have been) handled by the outer loop. This prevents self-referencing
        // npmdata.sets from triggering the circular-dependency guard.
        const siblingNames = new Set(entries.map((e) => parsePackageSpec(e.package).name));

        // Apply selector.presets: filter the target package's own sets by the preset tags
        // requested by the consumer. When selector.presets is empty, all sets pass through.
        const presetFilteredSets = filterEntriesByPresets(pkgNpmdataSets, selector.presets);
        if (verbose) {
          console.log(
            `[verbose] extract: ${pkg.name} has ${pkgNpmdataSets.length} npmdata set(s), ${presetFilteredSets.length} after preset filter`,
          );
        }

        // Self-referencing sets (same package, explicit selector.files) define which of the
        // current package's own files belong to each preset. They are safe to recurse into:
        // we pass installedPkgPaths with the current pkgPath so the recursive call reuses it
        // without reinstalling and without tripping the circular-dependency guard.
        const selfRefSets =
          selector.presets && selector.presets.length > 0
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

        if (
          selector.presets &&
          selector.presets.length > 0 &&
          pkgNpmdataSets.length > 0 &&
          presetFilteredSets.length === 0
        ) {
          throw new Error(
            `Presets (${selector.presets.join(', ')}) not found in any set of package "${pkg.name}"`,
          );
        }

        if (filteredSets.length > 0) {
          const visitedSet = new Set(visitedPackages);
          visitedSet.add(pkg.name);

          // Pass the current pkgPath for self-referencing sets so the recursive call skips
          // reinstallation and bypasses the circular-dependency guard.
          const preInstalled = new Map(installedPkgPaths ?? []);
          if (selfRefSets.length > 0) preInstalled.set(pkg.name, pkgPath);

          // Inherit caller overrides (force, dryRun, keepExisting, gitignore, managed) from current entry.
          // Caller-defined (non-undefined) values always take precedence; undefined propagates as-is
          // so defaults are only resolved at the leaf execute() level, not during recursion.
          const inheritedEntries = filteredSets.map((depEntry) => {
            const { path: depPath, ...restOutput } = depEntry.output ?? {};
            const inheritedOutput = {
              ...restOutput,
              path: path.join(outputConfig.path ?? '.', depPath ?? '.'),
              force: outputConfig.force ?? restOutput.force,
              dryRun: outputConfig.dryRun ?? restOutput.dryRun,
              keepExisting: outputConfig.keepExisting ?? restOutput.keepExisting,
              gitignore: outputConfig.gitignore ?? restOutput.gitignore,
              managed: outputConfig.managed ?? restOutput.managed,
              // Append symlinks and contentReplacements
              symlinks: [...(outputConfig.symlinks ?? []), ...(restOutput.symlinks ?? [])],
              contentReplacements: [
                ...(outputConfig.contentReplacements ?? []),
                ...(restOutput.contentReplacements ?? []),
              ],
            };
            return {
              ...depEntry,
              output: inheritedOutput,
            };
          });

          if (verbose) {
            console.log(
              `[verbose] extract: recursing into ${filteredSets.length} set(s) from ${pkg.name} (${selfRefSets.length} self-ref, ${externalSets.length} external)`,
            );
          }
          const subResult = await actionExtract({
            entries: inheritedEntries,
            cwd,
            verbose,
            onProgress,
            visitedPackages: visitedSet,
            installedPkgPaths: preInstalled,
          });
          result.added += subResult.added;
          result.modified += subResult.modified;
          result.deleted += subResult.deleted;
          result.skipped += subResult.skipped;
        }
      }

      // Create symlinks
      if (outputConfig.symlinks && outputConfig.symlinks.length > 0 && !outputConfig.dryRun) {
        if (verbose) {
          console.log(
            `[verbose] extract: creating ${outputConfig.symlinks.length} symlink(s) in ${outputDir}`,
          );
        }
        await createSymlinks(outputDir, outputConfig.symlinks);
      }

      onProgress?.({
        type: 'package-end',
        packageName: pkg.name,
        packageVersion: installedVersion,
      });
    }

    // Deferred deletions: delete after all filesets have been processed
    if (verbose && deferredDeletes.length > 0) {
      console.log(`[verbose] extract: performing ${deferredDeletes.length} deferred deletion(s)`);
    }
    await deleteFiles(deferredDeletes, verbose);
    result.deleted += deferredDeletes.length;

    // cleanup temp package.json and node_module if was created just for this extraction
    cleanupTempPackageJson(cwd, verbose);

    if (verbose) {
      console.log(
        `[verbose] extract: complete - added=${result.added} modified=${result.modified} deleted=${result.deleted} skipped=${result.skipped}`,
      );
    }
  } catch (error) {
    // Partial rollback: delete only newly created files
    if (verbose) {
      console.error(
        `[verbose] extract: error encountered, rolling back ${allNewlyCreated.length} newly created file(s): ${error}`,
      );
    }
    await rollback(allNewlyCreated);
    // Ensure temp package.json is cleaned up even on failure
    cleanupTempPackageJson(cwd, verbose);
    throw error;
  }

  return result;
}
