import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installMockPackage } from '../fileset/test-utils';

import { binpkg } from './binpkg';

const DATA_PKG_NAME = 'binpkg-test-data-pkg';
const DATA_PKG_FILES = {
  'data/file1.json': '{"key":"value"}',
  'data/file2.md': '# Doc',
  'docs/readme.md': '# Readme',
};

describe('binpkg', () => {
  let tmpDir: string;
  let binDir: string;
  let originalCwd: string;
  let exitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binpkg-test-'));

    // Install the mock data package into tmpDir so the CLI can resolve it
    await installMockPackage(DATA_PKG_NAME, '1.0.0', DATA_PKG_FILES, tmpDir);

    // Simulate the data package's own root: has package.json (with name + npmdata config)
    // and a bin/ subdirectory from which binpkg gets __dirname.
    const fakePkgRoot = path.join(tmpDir, 'fake-data-pkg');
    binDir = path.join(fakePkgRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    // The data package's package.json also contains an npmdata config with an external set.
    // binpkg must NOT use this config — it should only extract DATA_PKG_NAME itself.
    fs.writeFileSync(
      path.join(fakePkgRoot, 'package.json'),
      JSON.stringify({
        name: DATA_PKG_NAME,
        version: '1.0.0',
        npmdata: {
          sets: [
            {
              package: DATA_PKG_NAME,
              selector: { files: ['data/**'] },
              output: { path: '.' },
            },
            {
              package: 'nonexistent-external-pkg', // must NOT be extracted by binpkg
              output: { path: '.' },
            },
          ],
        },
      }),
    );

    // Move cwd to tmpDir so the CLI resolves packages from tmpDir/node_modules
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Mock process.exit so the test process doesn't actually exit
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 'undefined'})`);
    });
  }, 60_000);

  afterEach(() => {
    exitSpy.mockRestore();
    process.chdir(originalCwd);

    // Ensure all files are writable before cleanup (extracted files can be read-only)
    const makeWritable = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          const stat = fs.lstatSync(full);
          if (!stat.isSymbolicLink()) {
            fs.chmodSync(full, 0o755);
            if (stat.isDirectory()) makeWritable(full);
          }
        } catch {
          /* ignore */
        }
      }
    };
    makeWritable(tmpDir);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts all data package files when no selectors are passed', async () => {
    const outputDir = path.join(tmpDir, 'output-all');

    await expect(binpkg(binDir, ['--output', outputDir, '--gitignore=false'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data/file2.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/readme.md'))).toBe(true);
  }, 60_000);

  it('applies --files selector from CLI args — ignores data package npmdata config selector', async () => {
    const outputDir = path.join(tmpDir, 'output-files');

    // The data package npmdata config only selects 'data/**', but we pass 'docs/**' via CLI.
    // binpkg must use the CLI arg, not the config.
    await expect(
      binpkg(binDir, ['--output', outputDir, '--gitignore=false', '--files', 'docs/**']),
    ).rejects.toThrow('process.exit(0)');

    expect(fs.existsSync(path.join(outputDir, 'docs/readme.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'data/file2.md'))).toBe(false);
  }, 60_000);

  it('does not extract external packages listed in data package npmdata config', async () => {
    const outputDir = path.join(tmpDir, 'output-no-ext');

    // If binpkg used the npmdata config it would try to install 'nonexistent-external-pkg',
    // which does not exist, and would fail. A clean exit(0) proves it was not attempted.
    await expect(binpkg(binDir, ['--output', outputDir, '--gitignore=false'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(fs.existsSync(path.join(outputDir, 'data/file1.json'))).toBe(true);
  }, 60_000);

  it('rejects --packages flag with error and exit code 1', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(jest.fn());

    await expect(binpkg(binDir, ['--packages', 'other-pkg'])).rejects.toThrow('process.exit(1)');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot use --packages'));
    logSpy.mockRestore();
  }, 10_000);
});
