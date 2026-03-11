/* eslint-disable no-console */

import path from 'node:path';

import { NpmdataConfig, NpmdataExtractEntry, ProgressEvent } from '../types';
import { parsePackageSpec, getInstalledPackagePath, filterEntriesByPresets } from '../utils';
import { readOutputDirMarker } from '../fileset/markers';
import { checkFileset } from '../fileset/check';

export type CheckOptions = {
  entries: NpmdataExtractEntry[];
  config: NpmdataConfig | null;
  cwd: string;
  presets?: string[];
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  skipUnmanaged?: boolean;
};

export type CheckSummary = {
  missing: string[];
  modified: string[];
  extra: string[];
};

/**
 * Orchestrate check across all filesets, filtering out unmanaged entries.
 * Returns a summary of all drift found across all entries.
 */
// eslint-disable-next-line complexity
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const { entries, cwd, presets = [], verbose = false, onProgress } = options;
  const summary: CheckSummary = { missing: [], modified: [], extra: [] };

  // Filter by presets (same behaviour as purge)
  const filtered = filterEntriesByPresets(entries, presets);

  if (verbose) {
    console.log(
      `[verbose] check: verifying ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  for (const entry of filtered) {
    // Skip unmanaged entries — they write no marker so there is nothing to check.
    // The --unmanaged flag also suppresses checking for explicitly marked entries.
    if (entry.output?.unmanaged) continue;

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

    // Read existing marker

    const existingMarker = await readOutputDirMarker(outputDir);

    if (!pkgPath) {
      console.error(`Package ${pkg.name} is not installed. Run 'extract' first.`);
      summary.missing.push(...existingMarker.map((m) => m.path));
      continue;
    }

    const result = await checkFileset(
      pkgPath,
      outputDir,
      entry.selector ?? {},
      entry.output ?? {},
      existingMarker,
    );

    summary.missing.push(...result.missing);
    summary.modified.push(...result.modified);
    summary.extra.push(...result.extra);

    onProgress?.({
      type: 'package-end',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });
  }

  return summary;
}
