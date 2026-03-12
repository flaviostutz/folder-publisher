import path from 'node:path';
import fs from 'node:fs';

import {
  SelectorConfig,
  OutputConfig,
  ManagedFileMetadata,
  CheckResult,
  ContentReplacementConfig,
} from '../types';
import { hashFile, hashBuffer } from '../utils';
import { applyContentReplacementsToBuffer } from '../package/content-replacements';

import { enumeratePackageFiles } from './package-files';

/**
 * Check whether locally extracted files are in sync with their package source.
 * Reuses diff logic to classify files as missing, modified, or extra.
 * Applies contentReplacements before hash comparison.
 *
 * @param pkgPath       Absolute path to the installed package directory, or null if not installed.
 * @param outputDir     Absolute path to the output directory.
 * @param selector      SelectorConfig controlling which package files are in scope.
 * @param outputConfig  OutputConfig (used for contentReplacements).
 * @param marker        Managed file entries from the .npmdata marker.
 * @returns CheckResult with missing, modified, and extra arrays.
 */
export async function checkFileset(
  pkgPath: string | null,
  outputDir: string,
  selector: SelectorConfig,
  outputConfig: OutputConfig,
  marker: ManagedFileMetadata[],
): Promise<CheckResult> {
  const contentReplacements: ContentReplacementConfig[] = outputConfig.contentReplacements ?? [];

  if (!pkgPath) {
    // Package not installed
    return {
      missing: marker.map((m) => m.path),
      modified: [],
      extra: [],
    };
  }

  const managedByPath = new Map<string, ManagedFileMetadata>(marker.map((m) => [m.path, m]));

  // Enumerate files from package (in scope)
  const pkgFiles = await enumeratePackageFiles(pkgPath, selector);
  const pkgFileSet = new Set(pkgFiles);

  const result: CheckResult = { missing: [], modified: [], extra: [] };

  // Check each managed file
  for (const m of marker) {
    const destPath = path.join(outputDir, m.path);
    if (!fs.existsSync(destPath)) {
      result.missing.push(m.path);
      continue;
    }

    // Compare hash with content replacements applied
    if (pkgFileSet.has(m.path)) {
      const srcPath = path.join(pkgPath, m.path);
      const srcContent = fs.readFileSync(srcPath, 'utf8');
      const transformed = applyContentReplacementsToBuffer(srcContent, contentReplacements);
      const srcHash = hashBuffer(transformed);

      const destHash = await hashFile(destPath);

      if (srcHash !== destHash) {
        result.modified.push(m.path);
      }
    }
  }

  // Find extra files: in filtered package source but never extracted (not in marker).
  // Only perform this check when the marker is non-empty; an empty marker means no
  // extraction has taken place or everything was purged, so there is nothing to drift.
  if (marker.length > 0) {
    for (const relPath of pkgFiles) {
      if (!managedByPath.has(relPath)) {
        result.extra.push(relPath);
      }
    }
  }

  return result;
}
