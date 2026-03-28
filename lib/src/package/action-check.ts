/* eslint-disable no-console */
import { ProgressEvent, BasicPackageOptions } from '../types';
import { cleanupTempPackageJson, formatDisplayPath } from '../utils';

import { resolveFilesDetailed } from './resolve-files';
import { calculateDiff } from './calculate-diff';
import { isManagedSymlinkEntry } from './symlinks';
import { createSourceRuntime } from './source';

export type CheckOptions = BasicPackageOptions & {
  onProgress?: (event: ProgressEvent) => void;
};

export type CheckSummary = {
  missing: string[];
  conflict: string[];
  extra: string[];
};

/**
 * Check whether the output directories are in sync with the desired file state.
 *
 * Uses resolveFiles() to build the desired file list (installing packages as needed),
 * then calculateDiff() to find files that are missing, conflicting, or extra.
 * Conflict detection reports content/managed mismatches only — gitignore-only
 * conflicts are excluded since gitignore state is managed by extract, not a data
 * integrity issue.
 */
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const { entries, cwd, verbose = false, onProgress } = options;
  const summary: CheckSummary = { missing: [], conflict: [], extra: [] };
  const sourceRuntime = createSourceRuntime(cwd, verbose);

  if (verbose) {
    console.log(`[verbose] actionCheck: resolving files (cwd: ${formatDisplayPath(cwd, cwd)})`);
  }

  // Skip entries with managed=false — they write no marker so there is nothing to check.
  const managedEntries = entries.filter((e) => e.output?.managed !== false);
  if (managedEntries.length === 0) return summary;

  try {
    const resolved = await resolveFilesDetailed(managedEntries, {
      cwd,
      verbose,
      sourceRuntime,
      onProgress: (e) => {
        if (e.type === 'package-start' || e.type === 'package-end') onProgress?.(e);
      },
    });
    const resolvedFiles = resolved.files;

    if (verbose) {
      console.log(`[verbose] actionCheck: resolved ${resolvedFiles.length} desired file(s)`);
    }

    const managedResolvedFiles = resolvedFiles.filter((f) => f.managed);
    const diff = await calculateDiff(
      managedResolvedFiles,
      verbose,
      cwd,
      resolved.relevantPackagesByOutputDir,
    );

    summary.missing.push(...diff.missing.map((e) => e.relPath));
    summary.extra.push(
      ...diff.extra
        .filter((e) => !e.existing || !isManagedSymlinkEntry(e.existing))
        .map((e) => e.relPath),
    );
    // Only report conflicts where content or managed-state differ; gitignore-only
    // mismatches are not a data integrity issue.
    summary.conflict.push(
      ...diff.conflict
        .filter((e) => (e.conflictReasons ?? []).some((r) => r !== 'gitignore'))
        .map((e) => e.relPath),
    );

    if (verbose) {
      console.log(
        `[verbose] actionCheck: missing=${summary.missing.length}` +
          ` conflict=${summary.conflict.length} extra=${summary.extra.length}`,
      );
    }

    return summary;
  } finally {
    sourceRuntime.cleanup();
    cleanupTempPackageJson(cwd, verbose);
  }
}
