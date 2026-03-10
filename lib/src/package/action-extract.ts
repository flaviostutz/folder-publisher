/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import {
  NpmdataConfig,
  NpmdataExtractEntry,
  ProgressEvent,
  SelectorConfig,
  OutputConfig,
} from '../types';
import {
  parsePackageSpec,
  installOrUpgradePackage,
  getInstalledIfSatisfies,
  cleanupTempPackageJson,
} from '../utils';
import { diff } from '../fileset/diff';
import { execute, rollback, deleteFiles } from '../fileset/execute';
import { readOutputDirMarker } from '../fileset/markers';

import { createSymlinks, removeStaleSymlinks } from './symlinks';

export type ExtractOptions = {
  entries: NpmdataExtractEntry[];
  config: NpmdataConfig | null;
  cwd: string;
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  visitedPackages?: Set<string>;
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
    config,
    cwd,
    verbose = false,
    onProgress,
    visitedPackages = new Set<string>(),
  } = options;

  if (verbose) {
    console.log(
      `[verbose] extract: processing ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  const result: ExtractResult = { added: 0, modified: 0, deleted: 0, skipped: 0 };
  const allNewlyCreated: string[] = [];
  const deferredDeletes: string[] = [];

  try {
    for (const entry of entries) {
      const pkg = parsePackageSpec(entry.package);

      // Circular dependency detection
      if (visitedPackages.has(pkg.name)) {
        throw new Error(
          `Circular dependency detected: package "${pkg.name}" is already being extracted`,
        );
      }

      const outputDir = path.resolve(cwd, entry.output.path);
      const selector: SelectorConfig = entry.selector ?? {};
      const outputConfig: OutputConfig = entry.output;
      const contentReplacements = outputConfig.contentReplacements ?? [];

      onProgress?.({
        type: 'package-start',
        packageName: pkg.name,
        packageVersion: pkg.version ?? 'latest',
      });

      if (verbose) {
        console.log(
          `[verbose] extract: entry package=${entry.package} outputDir=${entry.output.path}`,
        );
      }

      // Phase 1: Install package
      const upgrade = selector.upgrade ?? false;
      const alreadyCached =
        !upgrade && getInstalledIfSatisfies(pkg.name, pkg.version, cwd) !== null;
      const pkgPath = await installOrUpgradePackage(pkg.name, pkg.version, upgrade, cwd, verbose);

      if (verbose) {
        let action = 'installed';
        if (alreadyCached) action = 'using cached';
        else if (upgrade) action = 'upgraded';
        console.log(`[verbose] extract: ${action} package ${pkg.name} at ${pkgPath}`);
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
      } catch {
        // fallback
      }

      // Remove stale symlinks before diff
      if (outputConfig.symlinks && outputConfig.symlinks.length > 0) {
        await removeStaleSymlinks(outputDir, outputConfig.symlinks);
      }

      // Phase 2: Read existing marker (all packages combined)

      const existingMarker = await readOutputDirMarker(outputDir);

      // Filter to current package only so diff's toDelete logic doesn't purge
      // files managed by other packages writing to the same output directory.
      const pkgMarker = existingMarker.filter((m) => m.packageName === pkg.name);

      // Phase 3: Diff phase (pure, no disk writes)

      const extractionMap = await diff(
        pkgPath,
        outputDir,
        selector,
        outputConfig,
        pkgMarker,
        contentReplacements,
      );

      // Phase 4: Abort on conflicts (unless force or unmanaged)
      if (extractionMap.conflicts.length > 0 && !outputConfig.force && !outputConfig.unmanaged) {
        const conflictPaths = extractionMap.conflicts.map((c) => c.relPath).join(', ');
        throw new Error(
          `Conflict: the following files exist and are not managed by npmdata: ${conflictPaths}. ` +
            `Use --force to overwrite or --unmanaged to skip.`,
        );
      }

      // Phase 5: Execute phase (disk writes)

      const executeResult = await execute(
        extractionMap,
        outputDir,
        outputConfig,
        pkg,
        installedVersion,
        existingMarker,
        cwd,
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
      } catch {
        // No package.json or no npmdata.sets
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        // Names of packages already being processed at this level (siblings).
        // Skip recursive resolution for any set entry that is already a sibling — those
        // will be (or have been) handled by the outer loop. This prevents self-referencing
        // npmdata.sets from triggering the circular-dependency guard.
        const siblingNames = new Set(entries.map((e) => parsePackageSpec(e.package).name));
        const filteredSets = pkgNpmdataSets.filter(
          (e) =>
            !siblingNames.has(parsePackageSpec(e.package).name) &&
            !visitedPackages.has(parsePackageSpec(e.package).name),
        );

        if (filteredSets.length > 0) {
          const visitedSet = new Set(visitedPackages);
          visitedSet.add(pkg.name);

          // Inherit caller overrides (force, dryRun, keepExisting) from current entry
          const inheritedEntries = filteredSets.map((depEntry) => {
            const { path: depPath, ...restOutput } = depEntry.output;
            const inheritedOutput = {
              ...restOutput,
              path: path.join(outputConfig.path, depPath),
              force: outputConfig.force ?? restOutput.force,
              dryRun: outputConfig.dryRun ?? restOutput.dryRun,
              keepExisting: outputConfig.keepExisting ?? restOutput.keepExisting,
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

          const subResult = await actionExtract({
            entries: inheritedEntries,
            config,
            cwd,
            verbose,
            onProgress,
            visitedPackages: visitedSet,
          });
          result.added += subResult.added;
          result.modified += subResult.modified;
          result.deleted += subResult.deleted;
          result.skipped += subResult.skipped;
        }
      }

      // Create symlinks
      if (outputConfig.symlinks && outputConfig.symlinks.length > 0 && !outputConfig.dryRun) {
        await createSymlinks(outputDir, outputConfig.symlinks);
      }

      onProgress?.({
        type: 'package-end',
        packageName: pkg.name,
        packageVersion: installedVersion,
      });
    }

    // Deferred deletions: delete after all filesets have been processed
    await deleteFiles(deferredDeletes);
    result.deleted += deferredDeletes.length;

    // cleanup temp package.json and node_module if was created just for this extraction
    cleanupTempPackageJson(cwd, verbose);
  } catch (error) {
    // Partial rollback: delete only newly created files
    await rollback(allNewlyCreated);
    throw error;
  }

  return result;
}
