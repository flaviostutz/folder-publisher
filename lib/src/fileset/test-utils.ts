import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import archiver from 'archiver';

function runCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command "${command}" failed with exit code ${result.status}`);
  }
  return result.stdout;
}

/**
 * Creates a mock npm package with the given files, packages it as a tar.gz,
 * and installs it into tmpDir/node_modules using pnpm.
 *
 * @param name - Name of the package to create.
 * @param version - Version of the package.
 * @param files - Map of relative file paths to file contents.
 * @param tmpDir - Temporary directory to use as the project root.
 * @returns The path to the installed package in node_modules.
 */
export const installMockPackage = async (
  name: string,
  version: string,
  files: Record<string, string>,
  tmpDir: string,
): Promise<string> => {
  const packageDir = path.join(tmpDir, `${name}-source`);
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // Create package.json
  const packageJson = { name, version };
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJson));

  // Create other files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(packageDir, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Create tar.gz file
  const tarGzPath = path.join(tmpDir, `${name.replaceAll('/', '-')}-${version}.tar.gz`);
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tarGzPath);
    const archive = archiver('tar', { gzip: true });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(packageDir, 'package');
    archive.finalize().catch(reject);
  });

  // Create package.json in tmpDir if it doesn't exist so pnpm recognizes it as a project
  const tmpDirPkgJson = path.join(tmpDir, 'package.json');
  if (!fs.existsSync(tmpDirPkgJson)) {
    fs.writeFileSync(tmpDirPkgJson, JSON.stringify({ name: 'tmp-test-project', version: '1.0.0' }));
  }

  // Install the tar.gz package into tmpDir/node_modules
  runCommand('pnpm', ['add', tarGzPath], tmpDir);

  // Return the installed package path in node_modules
  return path.join(tmpDir, 'node_modules', name);
};

export const createMockGitRepo = async (
  name: string,
  files: Record<string, string>,
  tmpDir: string,
  options?: {
    filedistConfig?: Record<string, unknown>;
    tag?: string;
  },
): Promise<{ repoDir: string; repoUrl: string; head: string; tag?: string }> => {
  const repoDir = path.join(tmpDir, `${name}-git-source`);
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
  fs.mkdirSync(repoDir, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  if (options?.filedistConfig) {
    fs.writeFileSync(
      path.join(repoDir, '.filedistrc.json'),
      JSON.stringify(options.filedistConfig),
    );
  }

  runCommand('git', ['init'], repoDir);
  runCommand('git', ['config', 'user.email', 'filedist-tests@example.com'], repoDir);
  runCommand('git', ['config', 'user.name', 'filedist tests'], repoDir);
  runCommand('git', ['add', '.'], repoDir);
  runCommand('git', ['commit', '-m', 'initial'], repoDir);
  if (options?.tag) {
    runCommand('git', ['tag', options.tag], repoDir);
  }

  const head = runCommand('git', ['rev-parse', 'HEAD'], repoDir).trim();

  return {
    repoDir,
    repoUrl: `file://${repoDir}`,
    head,
    tag: options?.tag,
  };
};
