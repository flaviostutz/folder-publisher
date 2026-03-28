/* eslint-disable no-console */
import path from 'node:path';

import {
  NpmdataExtractEntry,
  OutputConfig,
  SelectorConfig,
  ResolvedFile,
  ProgressEvent,
} from '../types';
import { filterEntriesByPresets, formatDisplayPath } from '../utils';
import { enumeratePackageFiles } from '../fileset/package-files';

import { loadNpmdataConfigFromDirectory } from './config';
import { mergeOutputConfig, mergeSelectorConfig } from './config-merge';
import { createSourceRuntime, parsePackageTarget, SourceRuntime } from './source';

export type ResolveOptions = {
  cwd: string;
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  sourceRuntime?: SourceRuntime;
};

export type ResolveFilesDetailedResult = {
  files: ResolvedFile[];
  relevantPackagesByOutputDir: Map<string, Set<string>>;
  noSyncOutputDirs: Set<string>;
};

function addRelevantPackage(
  relevantPackagesByOutputDir: Map<string, Set<string>>,
  outputDir: string,
  packageName: string,
): void {
  const relevantPackages = relevantPackagesByOutputDir.get(outputDir) ?? new Set<string>();
  relevantPackages.add(packageName);
  relevantPackagesByOutputDir.set(outputDir, relevantPackages);
}

function markNoSyncOutput(noSyncOutputDirs: Set<string>, outputDir: string, noSync: boolean): void {
  if (noSync) {
    noSyncOutputDirs.add(outputDir);
  }
}

/** Unique key for an entry used for recursion-cycle detection. */
function entryKey(
  entry: NpmdataExtractEntry,
  output: OutputConfig,
  selector: SelectorConfig,
  currentPkgPath?: string,
): string {
  const packageScope = entry.package ?? `__self__:${currentPkgPath ?? ''}`;
  return `${packageScope}|${JSON.stringify(selector)}|${JSON.stringify(output)}`;
}

/**
 * Recursively resolve all entries into a flat list of desired files.
 *
 * Two entry types are handled:
 *  - Self-package entry (no `package` field): enumerates files directly from the
 *    package context provided by the parent recursion level.
 *  - External-package entry (`package` field set): installs the package, reads its
 *    npmdata.sets, and recurses; when the package has no sets, files are enumerated
 *    directly (leaf behaviour).
 *
 * Duplicate (outputDir, relPath) pairs are deduplicated; conflicting managed/gitignore
 * settings for the same destination path throw an error.
 */
export async function resolveFiles(
  entries: NpmdataExtractEntry[],
  options: ResolveOptions,
): Promise<ResolvedFile[]> {
  const result = await resolveFilesDetailed(entries, options);
  return result.files;
}

export async function resolveFilesDetailed(
  entries: NpmdataExtractEntry[],
  options: ResolveOptions,
): Promise<ResolveFilesDetailedResult> {
  const visited = new Set<string>();
  const relevantPackagesByOutputDir = new Map<string, Set<string>>();
  const noSyncOutputDirs = new Set<string>();
  const sourceRuntime = options.sourceRuntime ?? createSourceRuntime(options.cwd, options.verbose);
  const raw = await resolveFilesInternal(
    entries,
    { path: '.' },
    {},
    // eslint-disable-next-line no-undefined
    undefined,
    // eslint-disable-next-line no-undefined
    undefined,
    // eslint-disable-next-line no-undefined
    undefined,
    { ...options, sourceRuntime },
    relevantPackagesByOutputDir,
    noSyncOutputDirs,
    visited,
  );
  return {
    files: deduplicateAndCheckConflicts(raw),
    relevantPackagesByOutputDir,
    noSyncOutputDirs,
  };
}

// eslint-disable-next-line complexity
async function resolveFilesInternal(
  entries: NpmdataExtractEntry[],
  inheritedOutput: OutputConfig,
  inheritedSelector: SelectorConfig,
  currentPkgPath: string | undefined,
  currentPkgName: string | undefined,
  currentPkgVersion: string | undefined,
  options: ResolveOptions,
  relevantPackagesByOutputDir: Map<string, Set<string>>,
  noSyncOutputDirs: Set<string>,
  visited: Set<string>,
): Promise<ResolvedFile[]> {
  const { cwd, verbose, onProgress, sourceRuntime } = options;
  const resolvedEntries = entries.map((entry) => {
    const mergedOutput = mergeOutputConfig(inheritedOutput, entry.output ?? {});
    const entrySelector = entry.selector ?? {};
    const mergedSelector = mergeSelectorConfig(inheritedSelector, entrySelector);
    return {
      entry,
      mergedOutput,
      mergedSelector,
      key: entryKey(entry, mergedOutput, mergedSelector, currentPkgPath),
    };
  });

  const entriesToProcess = resolvedEntries.filter(({ key }) => !visited.has(key));
  for (const { key } of entriesToProcess) visited.add(key);

  if (verbose && entriesToProcess.length > 0) {
    console.log(
      `[verbose] resolveFiles: processing ${entriesToProcess.length} entr${entriesToProcess.length === 1 ? 'y' : 'ies'}`,
    );
  }

  const results: ResolvedFile[] = [];

  for (const { entry, mergedOutput, mergedSelector } of entriesToProcess) {
    if (!entry.package) {
      // ── Self-package entry (no package field) ────────────────────────────
      // Enumerates files directly from the current package context.
      if (!currentPkgPath || !currentPkgName) {
        throw new Error(
          'A self-package entry (no "package" field) can only appear inside a ' +
            "package's own npmdata.sets.",
        );
      }

      const outputDir = path.resolve(cwd, mergedOutput.path ?? '.');
      addRelevantPackage(relevantPackagesByOutputDir, outputDir, currentPkgName);
      markNoSyncOutput(noSyncOutputDirs, outputDir, mergedOutput.noSync === true);
      const files = await enumeratePackageFiles(currentPkgPath, mergedSelector);

      if (verbose) {
        console.log(
          `[verbose] resolveFiles: self-package "${currentPkgName}" → ${files.length} file(s) to ${formatDisplayPath(outputDir, cwd)}`,
        );
      }

      for (const relPath of files) {
        results.push(
          buildResolvedFile(
            relPath,
            currentPkgPath,
            currentPkgName,
            currentPkgVersion ?? '0.0.0',
            outputDir,
            mergedOutput,
          ),
        );
      }
    } else {
      // ── External-package entry ────────────────────────────────────────────
      const pkg = parsePackageTarget(entry.package, entry.source);
      const upgrade = mergedSelector.upgrade ?? false;

      onProgress?.({
        type: 'package-start',
        packageName: pkg.packageName,
        packageVersion: pkg.requestedVersion ?? 'latest',
      });

      const resolvedPackage = await sourceRuntime!.resolvePackage(entry, upgrade);
      const pkgPath = resolvedPackage.packagePath;
      const installedVersion = resolvedPackage.packageVersion;

      if (verbose) {
        console.log(
          `[verbose] resolveFiles: resolved "${resolvedPackage.packageName}@${installedVersion}" at ${formatDisplayPath(pkgPath, cwd)}`,
        );
      }

      // Check whether this package declares its own npmdata.sets
      const depConfig = await loadNpmdataConfigFromDirectory(pkgPath);
      const pkgNpmdataSets = depConfig?.sets;

      const outputDir = path.resolve(cwd, mergedOutput.path ?? '.');
      addRelevantPackage(relevantPackagesByOutputDir, outputDir, resolvedPackage.packageName);
      markNoSyncOutput(noSyncOutputDirs, outputDir, mergedOutput.noSync === true);
      const hasSelfSet = (pkgNpmdataSets ?? []).some((setEntry) => !setEntry.package);

      // When a package declares self sets, those sets define how its own files are split
      // across outputs and managed flags. In that case, skip the blanket own-file pass.
      const ownFiles = hasSelfSet ? [] : await enumeratePackageFiles(pkgPath, mergedSelector);

      if (verbose) {
        console.log(
          `[verbose] resolveFiles: "${resolvedPackage.packageName}" own files → ${ownFiles.length} file(s) to ${formatDisplayPath(outputDir, cwd)}`,
        );
      }

      for (const relPath of ownFiles) {
        results.push(
          buildResolvedFile(
            relPath,
            pkgPath,
            resolvedPackage.packageName,
            installedVersion,
            outputDir,
            mergedOutput,
          ),
        );
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        for (const pkgSet of pkgNpmdataSets) {
          const setOutput = mergeOutputConfig(mergedOutput, pkgSet.output ?? {});
          const setOutputDir = path.resolve(cwd, setOutput.path ?? '.');
          markNoSyncOutput(noSyncOutputDirs, setOutputDir, setOutput.noSync === true);
          if (pkgSet.package) {
            addRelevantPackage(
              relevantPackagesByOutputDir,
              setOutputDir,
              parsePackageTarget(pkgSet.package, pkgSet.source).packageName,
            );
          } else {
            addRelevantPackage(
              relevantPackagesByOutputDir,
              setOutputDir,
              resolvedPackage.packageName,
            );
          }
        }

        // Apply preset filter
        const presetFilteredSets = filterEntriesByPresets(pkgNpmdataSets, mergedSelector.presets);

        if (
          mergedSelector.presets &&
          mergedSelector.presets.length > 0 &&
          pkgNpmdataSets.length > 0 &&
          presetFilteredSets.length === 0
        ) {
          throw new Error(
            `Presets (${mergedSelector.presets.join(', ')}) not found in any set of package "${resolvedPackage.packageName}"`,
          );
        }

        // Preemptively mark preset-excluded sets as visited
        for (const e of pkgNpmdataSets) {
          if (!presetFilteredSets.includes(e)) {
            const presetMergedOutput = mergeOutputConfig(mergedOutput, e.output ?? {});
            const presetMergedSelector = mergeSelectorConfig(mergedSelector, e.selector ?? {});
            visited.add(entryKey(e, presetMergedOutput, presetMergedSelector, pkgPath));
          }
        }

        // Self-package sets are followed whenever the package declares them,
        // because they define the package's own extraction semantics. When a
        // caller filters by selector.presets, those self sets are filtered by
        // the preset selection above.
        const setsToFollow = presetFilteredSets.filter(
          (e) => typeof e.package === 'string' || hasSelfSet,
        );

        if (verbose && setsToFollow.length > 0) {
          console.log(
            `[verbose] resolveFiles: "${resolvedPackage.packageName}" has ${pkgNpmdataSets.length} set(s)` +
              `, ${setsToFollow.length} to follow after preset/self-ref filter`,
          );
        }

        if (setsToFollow.length > 0) {
          const subResults = await resolveFilesInternal(
            setsToFollow,
            mergedOutput,
            mergedSelector,
            pkgPath,
            resolvedPackage.packageName,
            installedVersion,
            options,
            relevantPackagesByOutputDir,
            noSyncOutputDirs,
            visited,
          );
          results.push(...subResults);
        }
      }

      onProgress?.({
        type: 'package-end',
        packageName: resolvedPackage.packageName,
        packageVersion: installedVersion,
      });
    }
  }

  return results;
}

function buildResolvedFile(
  relPath: string,
  pkgPath: string,
  packageName: string,
  packageVersion: string,
  outputDir: string,
  output: OutputConfig,
): ResolvedFile {
  return {
    relPath,
    sourcePath: path.join(pkgPath, relPath),
    packageName,
    packageVersion,
    outputDir,
    managed: output.managed !== false,
    gitignore: output.gitignore !== false,
    force: output.force ?? false,
    ignoreIfExisting: output.keepExisting ?? false,
    noSync: output.noSync === true,
    contentReplacements: output.contentReplacements ?? [],
    symlinks: output.symlinks ?? [],
  };
}

/**
 * Remove duplicate (outputDir, relPath) pairs, checking that duplicates have
 * compatible managed and gitignore settings. Throws on conflict.
 */
function deduplicateAndCheckConflicts(files: ResolvedFile[]): ResolvedFile[] {
  const byKey = new Map<string, ResolvedFile>();
  for (const file of files) {
    const key = `${file.outputDir}|${file.relPath}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, file);
    } else if (existing.managed !== file.managed || existing.gitignore !== file.gitignore) {
      throw new Error(
        `Conflict in resolve: file "${file.relPath}" in "${file.outputDir}" is resolved by ` +
          `"${existing.packageName}" (managed=${existing.managed}, gitignore=${existing.gitignore}) ` +
          `and "${file.packageName}" (managed=${file.managed}, gitignore=${file.gitignore}) ` +
          `with different settings.`,
      );
    }
    // Same settings — keep first occurrence (idempotent)
  }
  return [...byKey.values()];
}
