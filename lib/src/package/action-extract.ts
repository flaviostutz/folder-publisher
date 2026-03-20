/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import { ResolvedFile, DiffResult, ProgressEvent, BasicPackageOptions } from '../types';
import { cleanupTempPackageJson, ensureDir, formatDisplayPath } from '../utils';
import { writeMarker, readOutputDirMarker, markerPath } from '../fileset/markers';
import { addToGitignore, readManagedGitignoreEntries } from '../fileset/gitignore';

import { createSymlinks, removeStaleSymlinks } from './symlinks';
import { applyContentReplacements } from './content-replacements';
import { resolveFiles } from './resolve-files';
import { calculateDiff } from './calculate-diff';

export type ExtractOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
};

export type ExtractResult = {
  added: number;
  modified: number;
  deleted: number;
  skipped: number;
};

/**
 * Extract managed files into the output directories.
 *
 * Two-phase approach:
 *  1. resolveFiles — installs packages and builds the complete desired file list.
 *  2. calculateDiff — compares desired files against each output directory.
 *  3. Apply disk changes: delete extra, add missing, resolve conflicts.
 */
// eslint-disable-next-line complexity
export async function actionExtract(options: ExtractOptions): Promise<ExtractResult> {
  const { entries, cwd, verbose = false, onProgress, dryRun } = options;
  const isDryRun = dryRun ?? entries.some((e) => e.output?.dryRun === true);

  const result: ExtractResult = { added: 0, modified: 0, deleted: 0, skipped: 0 };

  // ── Phase 1: Resolve desired files ──────────────────────────────────────
  let resolvedFiles: ResolvedFile[];
  try {
    resolvedFiles = await resolveFiles(entries, { cwd, verbose, onProgress });
  } finally {
    cleanupTempPackageJson(cwd, verbose);
  }

  if (verbose) {
    console.log(`[verbose] actionExtract: resolved ${resolvedFiles.length} desired file(s)`);
  }

  // ── Phase 2: Calculate diff ──────────────────────────────────────────────
  const diff = await calculateDiff(resolvedFiles, verbose, cwd);

  if (verbose) {
    console.log(
      `[verbose] actionExtract: diff ok=${diff.ok.length} missing=${diff.missing.length}` +
        ` conflict=${diff.conflict.length} extra=${diff.extra.length}`,
    );
  }

  // ── Pre-flight conflict check ──────────────────────────────────────────
  // Detect unmanaged-file conflicts before any disk writes.
  if (!isDryRun) {
    for (const entry of diff.conflict) {
      const desired = entry.desired!;
      const isUnmanagedConflict = !entry.existing && desired.managed;
      if (!desired.ignoreIfExisting && !desired.force && isUnmanagedConflict) {
        throw new Error(
          `Conflict: file "${entry.relPath}" in "${entry.outputDir}" exists and is not managed` +
            ` by npmdata.\nUse --force to overwrite or --managed=false to skip.`,
        );
      }
    }
  }

  // ── Count expected changes ─────────────────────────────────────────────
  result.added = diff.missing.length;
  result.deleted = diff.extra.length;
  for (const entry of diff.conflict) {
    const desired = entry.desired!;
    if (desired.ignoreIfExisting || !desired.managed) {
      result.skipped++;
    } else {
      result.modified++;
    }
  }
  result.skipped += diff.ok.length;

  if (isDryRun) return result;

  // ── Phase 3: Apply disk changes ──────────────────────────────────────────

  // Collect unique output directories
  const outputDirs = new Set(resolvedFiles.map((f) => f.outputDir));

  // Remove stale symlinks before writing new files
  for (const outputDir of outputDirs) {
    const dirFiles = resolvedFiles.filter((f) => f.outputDir === outputDir);
    const symlinks = dirFiles.flatMap((f) => f.symlinks);
    if (symlinks.length > 0) {
      await removeStaleSymlinks(outputDir, symlinks);
    }
  }

  // Delete extra managed files
  for (const entry of diff.extra) {
    const fullPath = path.join(entry.outputDir, entry.relPath);
    const gitignorePaths = readManagedGitignoreEntries(entry.outputDir);
    if (fs.existsSync(fullPath)) {
      fs.chmodSync(fullPath, 0o644);
      fs.unlinkSync(fullPath);
    }
    onProgress?.({
      type: 'file-deleted',
      packageName: entry.existing?.packageName ?? '',
      file: entry.relPath,
      managed: true,
      gitignore: gitignorePaths.has(entry.relPath),
    });
  }

  // Add missing files
  for (const entry of diff.missing) {
    const desired = entry.desired!;
    writeFileToOutput(
      desired.sourcePath,
      path.join(entry.outputDir, desired.relPath),
      desired.managed,
    );
    onProgress?.({
      type: 'file-added',
      packageName: desired.packageName,
      file: desired.relPath,
      managed: desired.managed,
      gitignore: desired.gitignore,
    });
  }

  // Emit file-skipped for unchanged files (diff.ok)
  for (const entry of diff.ok) {
    const desired = entry.desired!;
    onProgress?.({
      type: 'file-skipped',
      packageName: desired.packageName,
      file: desired.relPath,
      managed: desired.managed,
      gitignore: desired.gitignore,
    });
  }

  // Resolve conflicts
  for (const entry of diff.conflict) {
    const desired = entry.desired!;
    // managed=false: existing file is user-owned, leave it untouched
    if (desired.ignoreIfExisting || !desired.managed) {
      onProgress?.({
        type: 'file-skipped',
        packageName: desired.packageName,
        file: desired.relPath,
        managed: desired.managed,
        gitignore: desired.gitignore,
      });
      continue;
    }
    writeFileToOutput(
      desired.sourcePath,
      path.join(entry.outputDir, desired.relPath),
      desired.managed,
    );
    onProgress?.({
      type: 'file-modified',
      packageName: desired.packageName,
      file: desired.relPath,
      managed: desired.managed,
      gitignore: desired.gitignore,
    });
  }

  // Update marker and gitignore per output directory
  for (const outputDir of outputDirs) {
    await updateOutputDirMetadata(outputDir, diff, resolvedFiles, cwd, verbose);
  }

  // Apply symlinks and content replacements per output directory
  for (const outputDir of outputDirs) {
    const dirFiles = resolvedFiles.filter((f) => f.outputDir === outputDir);
    const symlinkConfigs = uniqueSymlinkConfigs(dirFiles);
    if (symlinkConfigs.length > 0) {
      await createSymlinks(outputDir, symlinkConfigs);
    }
    const contentReplacements = dirFiles.flatMap((f) => f.contentReplacements);
    if (contentReplacements.length > 0) {
      await applyContentReplacements(outputDir, contentReplacements);
    }
  }

  if (verbose) {
    console.log(
      `[verbose] actionExtract: complete — added=${result.added} modified=${result.modified}` +
        ` deleted=${result.deleted} skipped=${result.skipped}`,
    );
  }

  return result;
}

/** Copy a source file to dest, creating parent dirs if needed, and set permissions. */
function writeFileToOutput(srcPath: string, destPath: string, managed: boolean): void {
  ensureDir(path.dirname(destPath));
  if (fs.existsSync(destPath)) fs.chmodSync(destPath, 0o644);
  fs.copyFileSync(srcPath, destPath);
  if (managed) fs.chmodSync(destPath, 0o444);
}

/**
 * Update the .npmdata marker and .gitignore for one output directory after
 * disk changes have been applied.
 */
async function updateOutputDirMetadata(
  outputDir: string,
  diff: DiffResult,
  resolvedFiles: ResolvedFile[],
  cwd: string,
  verbose?: boolean,
): Promise<void> {
  const existingMarker = await readOutputDirMarker(outputDir);

  // Paths removed by this run (extra files that were deleted)
  const deletedPaths = new Set(
    diff.extra.filter((e) => e.outputDir === outputDir).map((e) => e.relPath),
  );

  // New or updated managed entries produced by this run
  const addedEntries = [
    ...diff.missing
      .filter((e) => e.outputDir === outputDir && e.desired?.managed)
      .map((e) => ({
        path: e.relPath,
        packageName: e.desired!.packageName,
        packageVersion: e.desired!.packageVersion,
      })),
    ...diff.conflict
      .filter((e) => e.outputDir === outputDir && e.desired?.managed && !e.desired.ignoreIfExisting)
      .map((e) => ({
        path: e.relPath,
        packageName: e.desired!.packageName,
        packageVersion: e.desired!.packageVersion,
      })),
  ];

  // Merge: keep existing (minus deleted + newly updated), then add new entries
  const updatedByPath = new Map(
    existingMarker
      .filter((m) => !deletedPaths.has(m.path) && !addedEntries.some((e) => e.path === m.path))
      .map((m) => [m.path, m]),
  );
  for (const e of addedEntries) updatedByPath.set(e.path, e);

  const updatedEntries = [...updatedByPath.values()];
  await writeMarker(markerPath(outputDir), updatedEntries);

  if (verbose) {
    console.log(
      `[verbose] updateOutputDirMetadata: ${formatDisplayPath(outputDir, cwd)}: marker updated (${updatedEntries.length} entries)`,
    );
  }

  // Update gitignore: include all remaining managed entries whose gitignore=true
  const resolvedByPath = new Map(
    resolvedFiles.filter((f) => f.outputDir === outputDir).map((f) => [f.relPath, f]),
  );
  const gitignorePaths = updatedEntries
    .filter((e) => {
      const resolved = resolvedByPath.get(e.path);
      // For files resolved in this run, honour their gitignore setting.
      // For files from other packages sharing the dir, default to true.
      return resolved ? resolved.gitignore : true;
    })
    .map((e) => e.path);

  await addToGitignore(outputDir, gitignorePaths);
}

/** Deduplicate SymlinkConfig objects by JSON representation. */
function uniqueSymlinkConfigs(files: ResolvedFile[]): import('../types').SymlinkConfig[] {
  const seen = new Set<string>();
  const result: import('../types').SymlinkConfig[] = [];
  for (const f of files) {
    for (const s of f.symlinks) {
      const key = JSON.stringify(s);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(s);
      }
    }
  }
  return result;
}
