import fs from 'node:fs';
import path from 'node:path';

import { ManagedFileMetadata, PurgeResult } from '../types';
import { removeAllSymlinks } from '../package/symlinks';

import { markerPath, readMarker, writeMarker } from './markers';
import { removeFromGitignore } from './gitignore';
import { MARKER_FILE } from './constants';

/**
 * Purge all managed files in entries from the output directory.
 * Also removes symlinks, empty directories, and cleans up marker / gitignore entries.
 *
 * Marker update: only the paths listed in `entries` are removed from the marker.
 * Entries belonging to other packages that share the same output directory are
 * preserved. The marker file is deleted only when it becomes empty.
 *
 * Gitignore update: only entries for the purged paths are removed.
 *
 * @param outputDir   Absolute path to the output directory.
 * @param entries     List of managed file entries to remove.
 * @param dryRun      If true, only report what would be removed without deleting.
 * @returns PurgeResult with counts of deleted, symlinks removed, and dirs removed.
 */
export async function purgeFileset(
  outputDir: string,
  entries: ManagedFileMetadata[],
  dryRun: boolean,
): Promise<PurgeResult> {
  const result: PurgeResult = { deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 };

  if (!fs.existsSync(outputDir)) return result;

  // 1. Delete managed files from disk
  for (const entry of entries) {
    const fullPath = path.join(outputDir, entry.path);
    if (fs.existsSync(fullPath)) {
      if (!dryRun) {
        try {
          fs.chmodSync(fullPath, 0o644);
          fs.unlinkSync(fullPath);
        } catch {
          // ignore
        }
      }
      result.deleted += 1;
    }
  }

  if (!dryRun) {
    // 2. Remove all symlinks pointing into outputDir
    result.symlinksRemoved = await removeAllSymlinks(outputDir);

    // 3. Remove empty directories bottom-up
    result.dirsRemoved = removeEmptyDirs(outputDir);

    // 4. Update marker: remove only the paths that were part of this purge operation.
    //    Entries from other packages sharing this output directory are preserved.
    //    The marker file is deleted automatically by writeMarker when it becomes empty.
    const purgedPaths = new Set(entries.map((e) => e.path));
    const currentMarkerEntries = await readMarker(markerPath(outputDir));
    const updatedMarkerEntries = currentMarkerEntries.filter((e) => !purgedPaths.has(e.path));
    await writeMarker(markerPath(outputDir), updatedMarkerEntries);

    // 5. Remove gitignore entries only for the purged paths
    await removeFromGitignore(outputDir, [...purgedPaths]);
  }

  return result;
}

/**
 * Remove empty directories bottom-up within the given directory.
 * Returns count of directories removed.
 */
function removeEmptyDirs(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return count;

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink() || entry === MARKER_FILE) continue;
    if (stat.isDirectory()) {
      count += removeEmptyDirs(fullPath);
      // Try to remove dir if now empty
      try {
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
          count += 1;
        }
      } catch {
        // ignore
      }
    }
  }
  return count;
}
