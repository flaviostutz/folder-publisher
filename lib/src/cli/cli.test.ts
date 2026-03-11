/* eslint-disable no-undefined */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installMockPackage } from '../fileset/test-utils';

import { cli } from './cli';

const PKG_NAME = 'cli-test-pkg';
const PKG_FILES = {
  'docs/guide.md': '# Guide',
  'docs/api.md': '# API',
};

describe('cli', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-cli-test-'));
    await installMockPackage(PKG_NAME, '1.0.0', PKG_FILES, tmpDir);
  }, 60_000);

  afterEach(() => {
    // Make all files writable before cleanup to handle read-only extracted files
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

  it('defaults to extract command when no command given', async () => {
    const outputDir = path.join(tmpDir, 'output');
    await cli(
      ['node', 'npmdata', '--packages', PKG_NAME, '--output', outputDir, '--no-gitignore'],
      tmpDir,
    );
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/api.md'))).toBe(true);
  }, 60_000);

  it('defaults to extract when first arg starts with -', async () => {
    const outputDir = path.join(tmpDir, 'output-flag');
    await cli(
      ['node', 'npmdata', '--packages', PKG_NAME, '--output', outputDir, '--no-gitignore'],
      tmpDir,
    );
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
  }, 60_000);

  it('routes to extract command explicitly', async () => {
    const outputDir = path.join(tmpDir, 'output-extract');
    await cli(
      [
        'node',
        'npmdata',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--no-gitignore',
      ],
      tmpDir,
    );
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
  }, 60_000);

  it('routes to check command — reports in-sync after extract', async () => {
    const outputDir = path.join(tmpDir, 'output-check');

    // Extract first
    await cli(
      [
        'node',
        'npmdata',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--no-gitignore',
      ],
      tmpDir,
    );

    // Write config so check knows what to verify
    fs.writeFileSync(
      path.join(tmpDir, '.npmdatarc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    await cli(['node', 'npmdata', 'check'], tmpDir);
    const { exitCode } = process;
    process.exitCode = prevExitCode as typeof process.exitCode;

    expect(exitCode).toBeUndefined(); // no drift → exits 0
  }, 60_000);

  it('routes to list command — lists managed files after extract', async () => {
    const outputDir = path.join(tmpDir, 'output-list');

    await cli(
      [
        'node',
        'npmdata',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--no-gitignore',
      ],
      tmpDir,
    );

    fs.writeFileSync(
      path.join(tmpDir, '.npmdatarc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await cli(['node', 'npmdata', 'list'], tmpDir);
    spy.mockRestore();

    expect(lines.some((l) => l.includes('docs/guide.md'))).toBe(true);
  }, 60_000);

  it('routes to purge command — removes managed files', async () => {
    const outputDir = path.join(tmpDir, 'output-purge');

    await cli(
      [
        'node',
        'npmdata',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--no-gitignore',
      ],
      tmpDir,
    );

    fs.writeFileSync(
      path.join(tmpDir, '.npmdatarc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);

    await cli(['node', 'npmdata', 'purge'], tmpDir);

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
  }, 60_000);

  it('routes to init command — scaffolds package.json', async () => {
    const initDir = path.join(tmpDir, 'my-data-pkg');
    fs.mkdirSync(initDir, { recursive: true });

    await cli(['node', 'npmdata', 'init', '--output', initDir], tmpDir);

    expect(fs.existsSync(path.join(initDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(initDir, 'bin', 'npmdata.js'))).toBe(true);
  }, 30_000);

  it('prints usage on global --help', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await cli(['node', 'npmdata', '--help'], tmpDir);
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/npmdata/i);
  });

  it('prints version on --version', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await cli(['node', 'npmdata', '--version'], tmpDir);
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/\d+\.\d+/);
  });

  it('routes to presets command — lists preset tags from config', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.npmdatarc.json'),
      JSON.stringify({
        sets: [
          { package: PKG_NAME, presets: ['prod', 'staging'] },
          { package: PKG_NAME, presets: ['dev'] },
        ],
      }),
    );

    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    const code = await cli(['node', 'npmdata', 'presets'], tmpDir);
    spy.mockRestore();

    expect(code).toBe(0);
    expect(lines).toContain('dev');
    expect(lines).toContain('prod');
    expect(lines).toContain('staging');
    expect(lines).toEqual(['dev', 'prod', 'staging']); // sorted
  }, 60_000);
});
