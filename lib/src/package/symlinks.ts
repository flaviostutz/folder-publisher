import fs from 'node:fs';
import path from 'node:path';

import { minimatch } from 'minimatch';

import { ManagedFileMetadata, ResolvedFile, SymlinkConfig } from '../types';
import { ensureDir } from '../utils';

export type ManagedSymlinkTarget = ManagedFileMetadata & {
  targetPath: string;
};

/**
 * Create symlinks for all files/dirs in outputDir matching source globs.
 * Each matching source is symlinked into the target directory.
 * Symlinks are created as relative paths.
 */
export async function createSymlinks(outputDir: string, configs: SymlinkConfig[]): Promise<void> {
  for (const config of configs) {
    const targetDir = path.resolve(outputDir, config.target);
    ensureDir(targetDir);

    const matches = findMatchingPaths(outputDir, config.source);
    for (const relPath of matches) {
      const srcAbsPath = path.join(outputDir, relPath);
      const linkName = path.basename(relPath);
      const linkPath = path.join(targetDir, linkName);

      const relTarget = path.relative(targetDir, srcAbsPath);

      if (isSymlink(linkPath)) {
        try {
          if (fs.readlinkSync(linkPath) === relTarget) {
            continue;
          }
        } catch {
          // fall through and recreate the symlink below
        }
      }

      // Remove existing symlink if present
      if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
        fs.unlinkSync(linkPath);
      }

      // Create relative symlink
      fs.symlinkSync(relTarget, linkPath);
    }
  }
}

/**
 * Collect marker entries for managed symlinks created in an output directory.
 *
 * Symlink ownership is attributed to the package/config combination that declared
 * the symlink operation. Duplicate output paths keep the first discovered owner.
 */
export function collectManagedSymlinkEntries(
  outputDir: string,
  files: ResolvedFile[],
): ManagedFileMetadata[] {
  return collectManagedSymlinkTargets(outputDir, files).map((entry) => ({
    path: entry.path,
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    kind: entry.kind,
  }));
}

export function collectManagedSymlinkTargets(
  outputDir: string,
  files: ResolvedFile[],
): ManagedSymlinkTarget[] {
  const uniqueConfigs = new Map<
    string,
    { packageName: string; packageVersion: string; config: SymlinkConfig }
  >();

  for (const file of files) {
    if (!file.managed) continue;
    for (const config of file.symlinks) {
      const key = `${file.packageName}|${file.packageVersion}|${JSON.stringify(config)}`;
      if (!uniqueConfigs.has(key)) {
        uniqueConfigs.set(key, {
          packageName: file.packageName,
          packageVersion: file.packageVersion,
          config,
        });
      }
    }
  }

  const byPath = new Map<string, ManagedSymlinkTarget>();
  for (const { packageName, packageVersion, config } of uniqueConfigs.values()) {
    const targetDir = path.resolve(outputDir, config.target);
    const matches = findMatchingPaths(outputDir, config.source);
    for (const relPath of matches) {
      const sourcePath = path.join(outputDir, relPath);
      const linkPath = path.join(targetDir, path.basename(relPath));
      const linkRelPath = path.relative(outputDir, linkPath);
      if (!byPath.has(linkRelPath)) {
        byPath.set(linkRelPath, {
          path: linkRelPath,
          packageName,
          packageVersion,
          kind: 'symlink',
          targetPath: sourcePath,
        });
      }
    }
  }

  return [...byPath.values()];
}

/** Remove only marker-managed symlinks that are no longer desired for this run. */
export async function removeStaleSymlinks(
  outputDir: string,
  managedEntries: ManagedFileMetadata[],
  desiredPaths: Set<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const seen = new Set<string>();

  for (const entry of managedEntries) {
    if ((entry.kind ?? 'file') !== 'symlink' || seen.has(entry.path)) continue;
    seen.add(entry.path);
    if (desiredPaths.has(entry.path)) continue;

    const linkPath = path.join(outputDir, entry.path);
    if (!isSymlink(linkPath)) continue;

    try {
      fs.unlinkSync(linkPath);
      removed.push(entry.path);
    } catch {
      // eslint-disable-next-line no-console
      console.log(`Failed to remove stale symlink at ${linkPath}`);
      // ignore
    }
  }

  return removed;
}

export function isManagedSymlinkEntry(entry: ManagedFileMetadata): boolean {
  return (entry.kind ?? 'file') === 'symlink';
}

export function isManagedFileEntry(entry: ManagedFileMetadata): boolean {
  return (entry.kind ?? 'file') !== 'symlink';
}

export function findManagedSymlinkEntries(
  entries: ManagedFileMetadata[],
  relevantPackages?: Set<string>,
): ManagedFileMetadata[] {
  return entries.filter(
    (entry) =>
      isManagedSymlinkEntry(entry) &&
      (!relevantPackages || relevantPackages.has(entry.packageName)),
  );
}

export function uniqueSymlinkConfigs(files: ResolvedFile[]): SymlinkConfig[] {
  const seen = new Set<string>();
  const result: SymlinkConfig[] = [];
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

/**
 * Remove ALL symlinks pointing into outputDir (used during purge).
 */
export async function removeAllSymlinks(outputDir: string): Promise<number> {
  let count = 0;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (isSymlink(fullPath)) {
        try {
          const target = fs.readlinkSync(fullPath);
          const absTarget = path.resolve(path.dirname(fullPath), target);
          if (absTarget.startsWith(outputDir)) {
            fs.unlinkSync(fullPath);
            count += 1;
          }
        } catch {
          // ignore
        }
      } else if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath);
      }
    }
  };
  walk(outputDir);
  return count;
}

function findMatchingPaths(outputDir: string, glob: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, baseDir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const relPath = path.relative(baseDir, fullPath);
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) continue;
      if (minimatch(relPath, glob, { dot: true })) {
        results.push(relPath);
      }
      if (lstat.isDirectory()) {
        walk(fullPath, baseDir);
      }
    }
  };
  walk(outputDir, outputDir);
  return results;
}

function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
