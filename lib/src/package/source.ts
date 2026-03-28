/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { NpmdataExtractEntry, SourceKind } from '../types';
import { formatDisplayPath, installOrUpgradePackage, spawnWithLog } from '../utils';

export type PackageTarget = {
  source: 'npm' | 'git';
  packageName: string;
  requestedVersion?: string;
  repository?: string;
};

export type ResolvedPackageSource = {
  source: 'npm' | 'git';
  packageName: string;
  packageVersion: string;
  packagePath: string;
};

export type SourceRuntime = {
  resolvePackage: (entry: NpmdataExtractEntry, upgrade: boolean) => Promise<ResolvedPackageSource>;
  cleanup: () => void;
};

const GIT_SOURCE_REGEX = /^(?:https?|ssh|git|file):\/\/|^git@/i;

export function parsePackageTarget(
  spec: string,
  requestedSource: SourceKind = 'auto',
): PackageTarget {
  const source = resolveSourceKind(spec, requestedSource);
  if (source === 'npm') {
    const atIdx = spec.lastIndexOf('@');
    if (atIdx > 0) {
      const requestedVersion = spec.slice(atIdx + 1);
      return {
        source,
        packageName: spec.slice(0, atIdx),
        ...(requestedVersion ? { requestedVersion } : {}),
      };
    }
    return { source, packageName: spec };
  }

  const { repository, ref } = splitGitSpec(spec);
  return {
    source,
    packageName: normalizeGitRepository(repository),
    ...(ref ? { requestedVersion: ref } : {}),
    repository,
  };
}

export function createSourceRuntime(cwd: string, verbose = false): SourceRuntime {
  const packageCache = new Map<string, ResolvedPackageSource>();
  const cloneDirs = new Set<string>();
  const tempRoot = path.join(cwd, '.npmdata-tmp');

  const ensureTempRoot = (): void => {
    if (!fs.existsSync(tempRoot)) {
      fs.mkdirSync(tempRoot, { recursive: true });
      if (verbose) {
        console.log(
          `[verbose] source: created temp git directory ${formatDisplayPath(tempRoot, cwd)}`,
        );
      }
    }
    ensureGitignoreContains(cwd, '.npmdata-tmp');
  };

  return {
    async resolvePackage(
      entry: NpmdataExtractEntry,
      upgrade: boolean,
    ): Promise<ResolvedPackageSource> {
      if (!entry.package) {
        throw new Error('resolvePackage requires an entry with a package spec');
      }

      const target = parsePackageTarget(entry.package, entry.source);
      const cacheKey = `${target.source}|${target.packageName}|${target.requestedVersion ?? ''}`;

      if (!upgrade) {
        const cached = packageCache.get(cacheKey);
        if (cached) return cached;
      }

      const resolved =
        target.source === 'git'
          ? resolveGitPackage(target, cwd, tempRoot, ensureTempRoot, verbose)
          : resolveNpmPackage(target, upgrade, cwd, verbose);

      const packageSource = await resolved;
      packageCache.set(cacheKey, packageSource);
      if (packageSource.source === 'git') {
        cloneDirs.add(packageSource.packagePath);
      }
      return packageSource;
    },
    cleanup(): void {
      for (const cloneDir of cloneDirs) {
        if (fs.existsSync(cloneDir)) {
          fs.rmSync(cloneDir, { recursive: true, force: true });
        }
      }
      cloneDirs.clear();

      if (fs.existsSync(tempRoot)) {
        try {
          if (fs.readdirSync(tempRoot).length === 0) {
            fs.rmdirSync(tempRoot);
          }
        } catch {
          // ignore cleanup failures
        }
      }
    },
  };
}

function resolveSourceKind(spec: string, requestedSource: SourceKind): 'npm' | 'git' {
  if (requestedSource === 'npm' || requestedSource === 'git') return requestedSource;
  return GIT_SOURCE_REGEX.test(spec) ? 'git' : 'npm';
}

function splitGitSpec(spec: string): { repository: string; ref?: string } {
  if (spec.startsWith('git@')) {
    const firstAt = spec.indexOf('@');
    const lastAt = spec.lastIndexOf('@');
    if (lastAt > firstAt) {
      const ref = spec.slice(lastAt + 1);
      return { repository: spec.slice(0, lastAt), ...(ref ? { ref } : {}) };
    }
    return { repository: spec };
  }

  const schemeEnd = spec.indexOf('://');
  if (schemeEnd !== -1) {
    const authStart = schemeEnd + 3;
    const pathStart = spec.indexOf('/', authStart);
    const authEnd = pathStart === -1 ? spec.length : pathStart;
    const lastAt = spec.lastIndexOf('@');
    if (lastAt >= authEnd) {
      const ref = spec.slice(lastAt + 1);
      return { repository: spec.slice(0, lastAt), ...(ref ? { ref } : {}) };
    }
    return { repository: spec };
  }

  throw new Error(
    `Git source requires a URL-like package spec. Received "${spec}". ` +
      'Use source="git" with a full repository URL such as https://host/org/repo@ref.',
  );
}

function normalizeGitRepository(repository: string): string {
  return repository.replace(/\/+$/, '');
}

async function resolveNpmPackage(
  target: PackageTarget,
  upgrade: boolean,
  cwd: string,
  verbose: boolean,
): Promise<ResolvedPackageSource> {
  const packagePath = await installOrUpgradePackage(
    target.packageName,
    target.requestedVersion,
    upgrade,
    cwd,
    verbose,
  );

  let installedVersion = '0.0.0';
  try {
    const pkgJsonContent = JSON.parse(
      fs.readFileSync(path.join(packagePath, 'package.json')).toString(),
    ) as { version: string };
    installedVersion = pkgJsonContent.version;
  } catch {
    // fallback
  }

  return {
    source: 'npm',
    packageName: target.packageName,
    packageVersion: installedVersion,
    packagePath,
  };
}

async function resolveGitPackage(
  target: PackageTarget,
  cwd: string,
  tempRoot: string,
  ensureTempRoot: () => void,
  verbose: boolean,
): Promise<ResolvedPackageSource> {
  ensureTempRoot();

  const cloneDir = path.join(tempRoot, buildCloneDirName(target));
  if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }

  if (verbose) {
    console.log(
      `[verbose] source: cloning ${target.repository} into ${formatDisplayPath(cloneDir, cwd)}`,
    );
  }
  spawnWithLog('git', ['clone', target.repository!, cloneDir], cwd, verbose, true);
  if (target.requestedVersion) {
    spawnWithLog('git', ['-C', cloneDir, 'checkout', target.requestedVersion], cwd, verbose, true);
  }

  const revision = spawnWithLog('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], cwd, verbose, true)
    .stdout.toString()
    .trim();
  const gitDir = path.join(cloneDir, '.git');
  if (fs.existsSync(gitDir)) {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }

  return {
    source: 'git',
    packageName: target.packageName,
    packageVersion: revision || target.requestedVersion || 'HEAD',
    packagePath: cloneDir,
  };
}

function buildCloneDirName(target: PackageTarget): string {
  const pathSegments = target.packageName.split(/[/:]/).filter(Boolean);
  const lastPathSegment = pathSegments.at(-1);
  const baseName = lastPathSegment?.replace(/\.git$/, '')?.replace(/[^\w.-]+/g, '-') ?? 'repo';
  const digest = crypto
    .createHash('sha1')
    .update(`${target.packageName}@${target.requestedVersion ?? ''}`)
    .digest('hex')
    .slice(0, 12);
  return `${baseName}-${digest}`;
}

function ensureGitignoreContains(cwd: string, entry: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${entry}\n`);
    return;
  }

  const lines = fs
    .readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!lines.includes(entry)) {
    fs.appendFileSync(gitignorePath, `\n${entry}\n`);
  }
}
