/* eslint-disable @typescript-eslint/no-empty-function */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { actionInit } from './action-init';

// Mock spawnSync globally so no real package manager commands run during tests
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawnSync: jest.fn(() => ({
    pid: 0,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-commonjs
const { spawnSync: mockSpawnSync } = require('node:child_process') as {
  spawnSync: jest.Mock;
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filedist-action-init-'));
  mockSpawnSync.mockClear();
  mockSpawnSync.mockReturnValue({
    pid: 0,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionInit', () => {
  it('creates package.json in a new directory', async () => {
    const outputDir = path.join(tmpDir, 'my-data-pkg');
    await actionInit(outputDir, false);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.name).toBe('my-data-pkg');
    expect(pkgJson.version).toBe('1.0.0');
    expect(pkgJson.bin).toBe('bin/filedist.js');
  });

  it('creates bin/filedist.js shim', async () => {
    const outputDir = path.join(tmpDir, 'my-pkg');
    await actionInit(outputDir, false);

    const binPath = path.join(outputDir, 'bin', 'filedist.js');
    expect(fs.existsSync(binPath)).toBe(true);
    const content = fs.readFileSync(binPath, 'utf8');
    expect(content).toContain("require('filedist').binpkg(__dirname, process.argv.slice(2))");
  });

  it('updates existing package.json without throwing', async () => {
    const outputDir = path.join(tmpDir, 'existing-pkg');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'package.json'),
      JSON.stringify({ name: 'existing-pkg', version: '2.0.0', dependencies: { some: '1' } }),
    );

    await actionInit(outputDir, false);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.name).toBe('existing-pkg');
    expect(pkgJson.version).toBe('2.0.0');
    expect(pkgJson.bin).toBe('bin/filedist.js');
    expect(pkgJson.dependencies.some).toBe('1');
  });

  it('skips creating bin/filedist.js when it already exists', async () => {
    const outputDir = path.join(tmpDir, 'existing-bin');
    fs.mkdirSync(path.join(outputDir, 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'bin', 'filedist.js'),
      '#!/usr/bin/env node\n// existing',
    );

    await actionInit(outputDir, false);

    const content = fs.readFileSync(path.join(outputDir, 'bin', 'filedist.js'), 'utf8');
    expect(content).toContain('// existing');
  });

  it('logs updated files when verbose=true', async () => {
    const outputDir = path.join(tmpDir, 'verbose-pkg');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await actionInit(outputDir, true);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('package.json'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('filedist.js'));
    consoleSpy.mockRestore();
  });

  it('adds --files patterns to package.json files list and filedist sets', async () => {
    const outputDir = path.join(tmpDir, 'files-pkg');
    await actionInit(outputDir, false, { files: ['docs/**', 'data/**'] });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.files).toContain('docs/**');
    expect(pkgJson.files).toContain('data/**');
    expect(pkgJson.files).toContain('package.json');
    expect(pkgJson.files).toContain('bin/filedist.js');
    expect(pkgJson.filedist.sets[0].selector.files).toEqual(['docs/**', 'data/**']);
  });

  it('adds --packages as external filedist sets', async () => {
    const outputDir = path.join(tmpDir, 'packages-pkg');
    await actionInit(outputDir, false, {
      files: ['conf/globals.js'],
      packages: ['eslint@8'],
    });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.filedist.sets).toHaveLength(2);
    expect(pkgJson.filedist.sets[1].package).toBe('eslint@8');
    expect(pkgJson.filedist.sets[1].selector.files).toEqual(['conf/globals.js']);
  });

  it('creates package-less self set as first entry in filedist sets', async () => {
    const outputDir = path.join(tmpDir, 'self-pkg');
    await actionInit(outputDir, false, {
      files: ['docs/**'],
      packages: ['some-pkg@1'],
    });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.filedist.sets[0].package).toBeUndefined();
    expect(pkgJson.filedist.sets[1].package).toBe('some-pkg@1');
  });

  it('runs package manager add for filedist after writing package.json', async () => {
    const outputDir = path.join(tmpDir, 'install-pkg');
    await actionInit(outputDir, false);

    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    expect(mockSpawnSync.mock.calls[0][0]).toBeTruthy();
    expect((mockSpawnSync.mock.calls[0][1] as string[]).join(' ')).toMatch(/filedist/);
  });

  it('includes external packages in the add command', async () => {
    const outputDir = path.join(tmpDir, 'ext-pkg');
    await actionInit(outputDir, false, { packages: ['eslint@8'] });

    const args = mockSpawnSync.mock.calls[0][1] as string[];
    expect(args.join(' ')).toMatch(/filedist/);
    expect(args.join(' ')).toMatch(/eslint@8/);
  });
});
