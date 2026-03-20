/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import {
  NpmdataExtractEntry,
  OutputConfig,
  SelectorConfig,
  ResolvedFile,
  ProgressEvent,
} from '../types';
import {
  parsePackageSpec,
  installOrUpgradePackage,
  filterEntriesByPresets,
  formatDisplayPath,
} from '../utils';
import { enumeratePackageFiles } from '../fileset/package-files';

import { mergeOutputConfig, mergeSelectorConfig } from './config-merge';

export type ResolveOptions = {
  cwd: string;
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
};

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
  const visited = new Set<string>();
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
    options,
    visited,
  );
  return deduplicateAndCheckConflicts(raw);
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
  visited: Set<string>,
): Promise<ResolvedFile[]> {
  const { cwd, verbose, onProgress } = options;
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
      const pkg = parsePackageSpec(entry.package);
      const upgrade = mergedSelector.upgrade ?? false;

      onProgress?.({
        type: 'package-start',
        packageName: pkg.name,
        packageVersion: pkg.version ?? 'latest',
      });

      const pkgPath = await installOrUpgradePackage(pkg.name, pkg.version, upgrade, cwd, verbose);

      let installedVersion = '0.0.0';
      try {
        const pkgJsonContent = JSON.parse(
          fs.readFileSync(path.join(pkgPath, 'package.json')).toString(),
        ) as { version: string };
        installedVersion = pkgJsonContent.version;
      } catch {
        // fallback
      }

      if (verbose) {
        console.log(
          `[verbose] resolveFiles: resolved "${pkg.name}@${installedVersion}" at ${formatDisplayPath(pkgPath, cwd)}`,
        );
      }

      // Check whether this package declares its own npmdata.sets
      let pkgNpmdataSets: NpmdataExtractEntry[] | undefined;
      try {
        const depPkgJson = JSON.parse(
          fs.readFileSync(path.join(pkgPath, 'package.json')).toString(),
        ) as { npmdata?: { sets?: NpmdataExtractEntry[] } };
        pkgNpmdataSets = depPkgJson.npmdata?.sets;
      } catch {
        // no sets
      }

      const outputDir = path.resolve(cwd, mergedOutput.path ?? '.');
      const hasSelfSet = (pkgNpmdataSets ?? []).some((setEntry) => !setEntry.package);

      // When a package declares self sets, those sets define how its own files are split
      // across outputs and managed flags. In that case, skip the blanket own-file pass.
      const ownFiles = hasSelfSet ? [] : await enumeratePackageFiles(pkgPath, mergedSelector);

      if (verbose) {
        console.log(
          `[verbose] resolveFiles: "${pkg.name}" own files → ${ownFiles.length} file(s) to ${formatDisplayPath(outputDir, cwd)}`,
        );
      }

      for (const relPath of ownFiles) {
        results.push(
          buildResolvedFile(relPath, pkgPath, pkg.name, installedVersion, outputDir, mergedOutput),
        );
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        // Apply preset filter
        const presetFilteredSets = filterEntriesByPresets(pkgNpmdataSets, mergedSelector.presets);

        if (
          mergedSelector.presets &&
          mergedSelector.presets.length > 0 &&
          pkgNpmdataSets.length > 0 &&
          presetFilteredSets.length === 0
        ) {
          throw new Error(
            `Presets (${mergedSelector.presets.join(', ')}) not found in any set of package "${pkg.name}"`,
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
            `[verbose] resolveFiles: "${pkg.name}" has ${pkgNpmdataSets.length} set(s)` +
              `, ${setsToFollow.length} to follow after preset/self-ref filter`,
          );
        }

        if (setsToFollow.length > 0) {
          const subResults = await resolveFilesInternal(
            setsToFollow,
            mergedOutput,
            mergedSelector,
            pkgPath,
            pkg.name,
            installedVersion,
            options,
            visited,
          );
          results.push(...subResults);
        }
      }

      onProgress?.({
        type: 'package-end',
        packageName: pkg.name,
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
