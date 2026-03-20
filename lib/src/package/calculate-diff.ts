/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import { ResolvedFile, DiffResult, ManagedFileMetadata } from '../types';
import { readManagedGitignoreEntries } from '../fileset/gitignore';
import { hashFile, hashBuffer, formatDisplayPath } from '../utils';
import { readOutputDirMarker } from '../fileset/markers';

import { applyContentReplacementsToBuffer } from './content-replacements';

/**
 * Calculate the diff between the desired file list (from resolveFiles) and the
 * actual state of each output directory.
 *
 * Only managed files (tracked in .npmdata markers) are included in the 'extra'
 * analysis, scoped to the packages represented in `resolvedFiles`.
 *
 * @returns DiffResult classifying each file as ok, missing, extra, or conflict.
 */
export async function calculateDiff(
  resolvedFiles: ResolvedFile[],
  verbose?: boolean,
  cwd?: string,
): Promise<DiffResult> {
  const result: DiffResult = { ok: [], missing: [], extra: [], conflict: [] };

  if (resolvedFiles.length === 0) return result;

  // Group resolved files by output directory
  const byOutputDir = new Map<string, ResolvedFile[]>();
  for (const f of resolvedFiles) {
    const arr = byOutputDir.get(f.outputDir) ?? [];
    arr.push(f);
    byOutputDir.set(f.outputDir, arr);
  }

  // Only consider marker entries from packages that appear in the resolved list
  const relevantPackages = new Set(resolvedFiles.map((f) => f.packageName));

  for (const [outputDir, desiredFiles] of byOutputDir) {
    const existingMarker = await readOutputDirMarker(outputDir);
    const managedByPath = new Map<string, ManagedFileMetadata>(
      existingMarker.map((m) => [m.path, m]),
    );
    const desiredByPath = new Map<string, ResolvedFile>(desiredFiles.map((f) => [f.relPath, f]));
    const gitignorePaths = readManagedGitignoreEntries(outputDir);

    // ── Classify desired files ──────────────────────────────────────────────
    for (const desired of desiredFiles) {
      await classifyDesiredFile(desired, outputDir, managedByPath, gitignorePaths, result);
    }

    // ── Extra managed files ─────────────────────────────────────────────────
    // Files that are managed (in the marker) under a relevant package but are
    // no longer in the desired file list.
    for (const m of existingMarker) {
      if (relevantPackages.has(m.packageName) && !desiredByPath.has(m.path)) {
        result.extra.push({ status: 'extra', relPath: m.path, outputDir, existing: m });
      }
    }

    if (verbose) {
      console.log(
        `[verbose] calculateDiff: ${formatDisplayPath(outputDir, cwd)}: ` +
          `ok=${result.ok.length} missing=${result.missing.length} ` +
          `conflict=${result.conflict.length} extra=${result.extra.length}`,
      );
    }
  }

  return result;
}

/**
 * Classify a single desired file against the current output directory state.
 * Appends to the appropriate result bucket (ok, missing, or conflict).
 */
async function classifyDesiredFile(
  desired: ResolvedFile,
  outputDir: string,
  managedByPath: Map<string, ManagedFileMetadata>,
  gitignorePaths: Set<string>,
  result: DiffResult,
): Promise<void> {
  const destPath = path.join(outputDir, desired.relPath);
  const destExists = fs.existsSync(destPath);

  if (!destExists) {
    result.missing.push({ status: 'missing', relPath: desired.relPath, outputDir, desired });
    return;
  }

  const conflictReasons: Array<'content' | 'managed' | 'gitignore'> = [];

  // Content check
  let srcHash: string;
  try {
    if (desired.contentReplacements.length > 0) {
      const srcContent = fs.readFileSync(desired.sourcePath, 'utf8');
      const transformed = applyContentReplacementsToBuffer(srcContent, desired.contentReplacements);
      srcHash = hashBuffer(transformed);
    } else {
      srcHash = await hashFile(desired.sourcePath);
    }
  } catch {
    srcHash = await hashFile(desired.sourcePath);
  }
  const destHash = await hashFile(destPath);
  if (srcHash !== destHash) conflictReasons.push('content');

  // Managed-state check
  const isManaged = managedByPath.has(desired.relPath);
  if (desired.managed !== isManaged) conflictReasons.push('managed');

  // Gitignore-state check
  const isGitignored = gitignorePaths.has(desired.relPath);
  if (desired.gitignore !== isGitignored) conflictReasons.push('gitignore');

  if (conflictReasons.length === 0) {
    result.ok.push({
      status: 'ok',
      relPath: desired.relPath,
      outputDir,
      desired,
      existing: managedByPath.get(desired.relPath),
    });
  } else {
    result.conflict.push({
      status: 'conflict',
      relPath: desired.relPath,
      outputDir,
      desired,
      existing: managedByPath.get(desired.relPath),
      conflictReasons,
    });
  }
}
