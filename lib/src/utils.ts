/* eslint-disable no-console */
/* eslint-disable no-undefined */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

import semver from 'semver';
import { detect } from 'package-manager-detector/detect';
import { resolveCommand } from 'package-manager-detector/commands';

import { NpmdataExtractEntry, PackageConfig } from './types';

/**
 * Parse a package spec like "my-pkg@^1.2.3" or "@scope/pkg@2.x" into name and version.
 * The version separator is the LAST "@" so that scoped packages ("@scope/name") are handled.
 */
export function parsePackageSpec(spec: string): PackageConfig {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx > 0) {
    return { name: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) || undefined };
  }

  return { name: spec, version: undefined };
}

/**
 * Compute the SHA-256 hash of a file.
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Compute the SHA-256 hash of an in-memory buffer or string.
 * Used to hash content that has been transformed in memory before comparison.
 */
export function hashBuffer(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Synchronous file hash (SHA-256).
 */
export function hashFileSync(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Detect whether a file is binary by scanning it for null bytes.
 * Reads up to the first 8 KB only.
 */
export function isBinaryFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytesRead).includes(0x00);
  } catch {
    return false;
  }
}

/**
 * Return the installed package path if already present and satisfies the requested version.
 */
export function getInstalledIfSatisfies(
  name: string,
  version: string | undefined,
  workDir: string,
): string | null {
  const installedPath = path.join(workDir, 'node_modules', name, 'package.json');
  if (!fs.existsSync(installedPath)) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  const installedPkg = JSON.parse(fs.readFileSync(installedPath).toString()) as {
    version?: string;
  };
  const installedVersion = installedPkg.version ?? '';
  if (!version || semver.satisfies(installedVersion, version)) {
    return path.dirname(installedPath);
  }
  // eslint-disable-next-line unicorn/no-null
  return null;
}

/**
 * Run the package-manager install/upgrade command for a given spec.
 * Detects the package manager in use and executes the appropriate CLI command.
 */
async function runPackageManagerCommand(
  spec: string,
  commandType: 'add' | 'upgrade',
  workDir: string,
  verbose?: boolean,
): Promise<void> {
  if (verbose) {
    console.log(
      `[verbose] Running package manager command for spec "${spec}" with type "${commandType}" in directory "${formatDisplayPath(workDir, workDir)}"`,
    );
  }
  const detected = await detect({ cwd: workDir });
  const agent = detected?.agent ?? 'npm';

  if (verbose) {
    console.log(`[verbose] Detected package manager: ${agent}`);
  }
  const resolved = resolveCommand(agent, commandType, [spec]);
  if (!resolved) {
    throw new Error(`Could not resolve "${commandType}" command for package manager "${agent}"`);
  }

  const extraArgs: string[] = [];

  // Always install as a dev dependency
  if (commandType === 'add') {
    extraArgs.push(agent === 'deno' ? '-d' : '-D');
  }

  // pnpm in a workspace root requires --workspace-root so it doesn't refuse to install
  if (agent === 'pnpm' && fs.existsSync(path.join(workDir, 'pnpm-workspace.yaml'))) {
    extraArgs.push('--workspace-root');
  }

  spawnWithLog(resolved.command, [...resolved.args, ...extraArgs], workDir, verbose, true);
}

/**
 * Install and/or upgrade a package using the detected package manager.
 * Returns the installed package path under node_modules.
 * If no package.json exists in the working directory, one is initialised automatically.
 */
export async function installOrUpgradePackage(
  name: string,
  version: string | undefined,
  upgrade: boolean,
  cwd?: string,
  verbose?: boolean,
): Promise<string> {
  const workDir = cwd ?? process.cwd();

  if (verbose) {
    console.log(
      `[verbose] installing/upgrading package="${name}", version="${version}", upgrade=${upgrade}, cwd="${formatDisplayPath(workDir, workDir)}"`,
    );
  }
  const spec = version ? `${name}@${version}` : `${name}@latest`;

  // Check if already installed with a satisfying version (skip install if not upgrading)
  if (!upgrade) {
    const cached = getInstalledIfSatisfies(name, version, workDir);
    if (cached) {
      if (verbose) {
        console.log(`[verbose] installed package is already up to date`);
      }
      return cached;
    }
  }

  // Ensure a package.json exists so the package manager can operate
  // this happens when npmdata is used as npx without a package.json in the current directory, for example
  const pkgJsonPath = path.join(workDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    if (verbose) {
      console.log(
        `[verbose] No package.json found in ${formatDisplayPath(workDir, workDir)}, initializing one`,
      );
    }
    initTempPackageJson(workDir, verbose);

    // reinstall itself to ensure it's present in node_modules for later use (e.g. to access its own package.json)
    // this might happen if using npx, for example, which runs the package without installing it in the local node_modules
    const selfPkgJsonPath = path.join(__dirname, '..', 'package.json');
    const selfPkg = JSON.parse(fs.readFileSync(selfPkgJsonPath).toString()) as {
      name: string;
      version: string;
    };
    const selfSpec = `${selfPkg.name}@${selfPkg.version}`;
    if (verbose) {
      console.log(
        `[verbose] reinstalling self (${selfSpec}) in dir ${formatDisplayPath(workDir, workDir)} to ensure it's upgraded`,
      );
    }
    await runPackageManagerCommand(selfSpec, 'add', workDir, verbose);
  }

  // install or upgrade the requested package
  // make sure it's in package.json dependencies (needed before "upgrade")
  await runPackageManagerCommand(spec, 'add', workDir, verbose);
  if (upgrade) {
    await runPackageManagerCommand(spec, 'upgrade', workDir, verbose);
  }

  let pkgPath = path.join(workDir, 'node_modules', name);
  if (!fs.existsSync(pkgPath)) {
    // Fall back to Node.js module resolution, which handles pnpm workspaces where the
    // package may be installed in the workspace root's node_modules rather than locally.
    if (verbose) {
      console.warn(
        `[verbose] ${formatDisplayPath(pkgPath, workDir)} not found, trying require.resolve fallback`,
      );
    }
    try {
      const resolved = require.resolve(`${name}/package.json`, { paths: [workDir] });
      pkgPath = path.dirname(resolved);
      if (verbose) {
        console.log(
          `[verbose] resolved ${name} via require.resolve to ${formatDisplayPath(pkgPath, workDir)}`,
        );
      }
    } catch {
      throw new Error(
        `Package "${name}" was not found at "${path.join(workDir, 'node_modules', name)}" after installation. ` +
          `Ensure you are running from a directory that has a package.json file.`,
      );
    }
  }
  return pkgPath;
}

/**
 * Return the installed package path under cwd/node_modules, or null if not installed.
 */
export function getInstalledPackagePath(name: string, cwd?: string): string | null {
  const workDir = cwd ?? process.cwd();
  const pkgJsonPath = path.join(workDir, 'node_modules', name, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    return path.dirname(pkgJsonPath);
  }
  // eslint-disable-next-line unicorn/no-null
  return null;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Format a path for logs relative to the current working directory used by the action.
 */
export function formatDisplayPath(targetPath: string, cwd?: string): string {
  const baseDir = path.resolve(cwd ?? process.cwd());
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.normalize(targetPath)
    : path.resolve(baseDir, targetPath);
  const relativePath = path.relative(baseDir, resolvedTarget);

  return relativePath.length === 0 ? '.' : relativePath;
}

/**
 * Filter entries by requested presets.
 * When no presets are requested, all entries pass through.
 */
export function filterEntriesByPresets(
  entries: NpmdataExtractEntry[],
  presets: string[] | undefined,
): NpmdataExtractEntry[] {
  if (!presets || presets.length === 0) return entries;
  return entries.filter((entry) => {
    // entry.presets tags the set for consumer-side --presets filtering;
    // entry.selector.presets is forwarded to the target package's own nested sets filtering.
    // Both are valid selectors so that ad-hoc --packages + --presets CLI usage also works.
    const entryPresets = new Set([...(entry.presets ?? []), ...(entry.selector?.presets ?? [])]);
    return presets.some((p) => entryPresets.has(p));
  });
}

/**
 * Initialise a minimal package.json and ensure node_modules is listed in .gitignore
 * for the given working directory.
 */
export function initTempPackageJson(workDir: string, verbose?: boolean): void {
  const pkgJsonPath = path.join(workDir, 'package.json');
  if (verbose) {
    console.log(
      `[verbose] extract: creating temporary package.json at ${formatDisplayPath(pkgJsonPath, workDir)} for this extraction`,
    );
  }

  fs.writeFileSync(
    pkgJsonPath,
    JSON.stringify({ name: 'npmdata-tmp', version: '99.99.99', private: true }, undefined, 2),
  );

  // Ensure node_modules is ignored in .gitignore
  const gitignorePath = path.join(workDir, '.gitignore');
  const gitignoreEntry = 'node_modules';
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    const lines = existing.split('\n').map((l) => l.trim());
    if (!lines.includes(gitignoreEntry)) {
      fs.appendFileSync(gitignorePath, `\n${gitignoreEntry}\n`);
    }
  } else {
    fs.writeFileSync(gitignorePath, `${gitignoreEntry}\n`);
  }
}

export function cleanupTempPackageJson(cwd: string, verbose?: boolean): void {
  const tempPkgJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(tempPkgJsonPath)) return;

  // verify if this package.json was created by us (npmdata) by checking its name and version
  const tempPkgJsonContent = JSON.parse(fs.readFileSync(tempPkgJsonPath).toString()) as {
    name: string;
    version: string;
  };
  if (tempPkgJsonContent.name !== 'npmdata-tmp' || tempPkgJsonContent.version !== '99.99.99')
    return;

  if (verbose) {
    console.log(
      `[verbose] extract: removing temporary package.json and node_modules at ${formatDisplayPath(tempPkgJsonPath, cwd)} created for this extraction`,
    );
  }
  // remove package.json
  fs.unlinkSync(tempPkgJsonPath);
  // remove node_modules
  const tempNodeModulesPath = path.join(cwd, 'node_modules');
  if (fs.existsSync(tempNodeModulesPath)) {
    fs.rmSync(tempNodeModulesPath, { recursive: true, force: true });
  }
  // cleanup .gitignore if it only contains node_modules (optional, can be left as is)
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    const lines = existing.split('\n').map((l) => l.trim());
    if (lines.length === 1 && lines[0] === 'node_modules') {
      if (verbose) {
        console.log(`[verbose] Removing .gitignore entries`);
      }
      fs.unlinkSync(gitignorePath);
    }
  }
}

export function spawnWithLog(
  command: string,
  args: string[],
  workDir: string,
  verbose: boolean | undefined,
  failOnError: boolean,
): ReturnType<typeof spawnSync> {
  const scriptCmd = `${command} ${args.join(' ')}`;
  if (verbose) {
    console.log(
      `[verbose] Running command: ${scriptCmd} in ${formatDisplayPath(workDir, workDir)}`,
    );
  }
  const result = spawnSync(scriptCmd, undefined, {
    cwd: workDir,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (verbose || result.status !== 0) {
    if (result.stdout.toString().length > 0) {
      console.log(result.stdout.toString());
    }
    if (result.stderr.toString().length > 0) {
      console.error(result.stderr.toString());
    }
  }

  if (result.error) {
    if (verbose) {
      console.error(`[verbose] Error: ${result.error.message}`);
    }
    if (failOnError) {
      throw result.error;
    }
  }

  if (result.status !== 0 && failOnError) {
    throw new Error(`Command "${scriptCmd}" failed with exit code ${result.status}`);
  }

  return result;
}
