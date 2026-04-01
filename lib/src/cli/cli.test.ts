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
      ['node', 'filedist', '--packages', PKG_NAME, '--output', outputDir, '--gitignore=false'],
      tmpDir,
    );
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/api.md'))).toBe(true);
  }, 60_000);

  it('defaults to extract when first arg starts with -', async () => {
    const outputDir = path.join(tmpDir, 'output-flag');
    await cli(
      ['node', 'filedist', '--packages', PKG_NAME, '--output', outputDir, '--gitignore=false'],
      tmpDir,
    );
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
  }, 60_000);

  it('routes to extract command explicitly', async () => {
    const outputDir = path.join(tmpDir, 'output-extract');
    await cli(
      [
        'node',
        'filedist',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--gitignore=false',
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
        'filedist',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--gitignore=false',
      ],
      tmpDir,
    );

    // Write config so check knows what to verify
    fs.writeFileSync(
      path.join(tmpDir, '.filedistrc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    const exitCode = await cli(['node', 'filedist', 'check'], tmpDir);

    expect(exitCode).toBe(0); // no drift → exits 0
  }, 60_000);

  it('routes to check command — returns exit code 1 when drift detected', async () => {
    const outputDir = path.join(tmpDir, 'output-check-drift');

    // Extract first
    await cli(
      [
        'node',
        'filedist',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--gitignore=false',
      ],
      tmpDir,
    );

    // Tamper with an extracted file to create drift (files are read-only after extract)
    const tamperedFile = path.join(outputDir, 'docs/guide.md');
    fs.chmodSync(tamperedFile, 0o644);
    fs.writeFileSync(tamperedFile, '# Tampered');

    fs.writeFileSync(
      path.join(tmpDir, '.filedistrc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    const exitCode = await cli(['node', 'filedist', 'check'], tmpDir);

    expect(exitCode).toBe(1); // drift detected → exit code 1
  }, 60_000);

  it('routes to list command — lists managed files after extract', async () => {
    const outputDir = path.join(tmpDir, 'output-list');

    await cli(
      [
        'node',
        'filedist',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--gitignore=false',
      ],
      tmpDir,
    );
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await cli(['node', 'filedist', 'list'], outputDir);
    spy.mockRestore();

    expect(lines.some((l) => l.includes('docs/guide.md'))).toBe(true);
  }, 60_000);

  it('routes to purge command — removes managed files', async () => {
    const outputDir = path.join(tmpDir, 'output-purge');

    await cli(
      [
        'node',
        'filedist',
        'extract',
        '--packages',
        PKG_NAME,
        '--output',
        outputDir,
        '--gitignore=false',
      ],
      tmpDir,
    );

    fs.writeFileSync(
      path.join(tmpDir, '.filedistrc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);

    await cli(['node', 'filedist', 'purge'], tmpDir);

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
  }, 60_000);

  it('routes to init command — scaffolds package.json', async () => {
    const initDir = path.join(tmpDir, 'my-data-pkg');
    fs.mkdirSync(initDir, { recursive: true });

    await cli(['node', 'filedist', 'init', '--output', initDir], tmpDir);

    expect(fs.existsSync(path.join(initDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(initDir, 'bin', 'filedist.js'))).toBe(true);
  }, 30_000);

  it('prints usage on global --help', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await cli(['node', 'filedist', '--help'], tmpDir);
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/usage: filedist \[command] \[options]/i);
    expect(lines.join('\n')).toMatch(/extract \(default\)/i);
    expect(lines.join('\n')).toMatch(/check/i);
    expect(lines.join('\n')).toMatch(/presets/i);
    expect(lines.join('\n')).not.toMatch(/--packages/);
  });

  it('prints version on --version', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await cli(['node', 'filedist', '--version'], tmpDir);
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/\d+\.\d+/);
  });

  it('routes to presets command — lists preset tags from config', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.filedistrc.json'),
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
    const code = await cli(['node', 'filedist', 'presets'], tmpDir);
    spy.mockRestore();

    expect(code).toBe(0);
    expect(lines).toContain('dev');
    expect(lines).toContain('prod');
    expect(lines).toContain('staging');
    expect(lines).toEqual(['dev', 'prod', 'staging']); // sorted
  }, 60_000);

  it('--config loads configuration from an explicit file path', async () => {
    const outputDir = path.join(tmpDir, 'output-custom-cfg');
    const configFile = path.join(tmpDir, 'my-filedist.json');

    fs.writeFileSync(
      configFile,
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    // No .filedistrc in tmpDir — config comes only from --config
    await cli(['node', 'filedist', 'extract', '--config', configFile], tmpDir);

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/api.md'))).toBe(true);
  }, 60_000);

  it('--config overrides auto-discovered config when both exist', async () => {
    const outputDefault = path.join(tmpDir, 'output-default');
    const outputCustom = path.join(tmpDir, 'output-custom');
    const configFile = path.join(tmpDir, 'custom.json');

    // Write an auto-discovered config that points to outputDefault
    fs.writeFileSync(
      path.join(tmpDir, '.filedistrc.json'),
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDefault, gitignore: false } }],
      }),
    );

    // Write the custom config that points to outputCustom
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputCustom, gitignore: false } }],
      }),
    );

    await cli(['node', 'filedist', 'extract', '--config', configFile], tmpDir);

    // Only outputCustom should be populated
    expect(fs.existsSync(path.join(outputCustom, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDefault, 'docs/guide.md'))).toBe(false);
  }, 60_000);

  it('--config works with relative file path', async () => {
    const outputDir = path.join(tmpDir, 'output-relative');
    const configFile = path.join(tmpDir, 'relative-cfg.json');

    fs.writeFileSync(
      configFile,
      JSON.stringify({
        sets: [{ package: PKG_NAME, output: { path: outputDir, gitignore: false } }],
      }),
    );

    await cli(['node', 'filedist', 'extract', '--config', 'relative-cfg.json'], tmpDir);

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
  }, 60_000);

  it('config defaultPresets are used when --presets is omitted and overridden when provided', async () => {
    const defaultOutput = path.join(tmpDir, 'output-default');
    const overrideOutput = path.join(tmpDir, 'output-override');
    const configFile = path.join(tmpDir, 'default-presets.json');

    fs.writeFileSync(
      configFile,
      JSON.stringify({
        defaultPresets: ['docs'],
        sets: [
          {
            package: PKG_NAME,
            selector: { files: ['docs/guide.md'] },
            output: { path: defaultOutput, gitignore: false },
            presets: ['docs'],
          },
          {
            package: PKG_NAME,
            selector: { files: ['docs/api.md'] },
            output: { path: overrideOutput, gitignore: false },
            presets: ['api'],
          },
        ],
      }),
    );

    await cli(['node', 'filedist', 'extract', '--config', configFile], tmpDir);

    expect(fs.existsSync(path.join(defaultOutput, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(overrideOutput, 'docs/api.md'))).toBe(false);

    await cli(['node', 'filedist', 'extract', '--config', configFile, '--presets', 'api'], tmpDir);

    expect(fs.existsSync(path.join(overrideOutput, 'docs/api.md'))).toBe(true);
  }, 60_000);

  it('--all ignores config defaultPresets and processes all matching entries', async () => {
    const defaultOutput = path.join(tmpDir, 'output-default');
    const allOutput = path.join(tmpDir, 'output-all');
    const configFile = path.join(tmpDir, 'all-default-presets.json');

    fs.writeFileSync(
      configFile,
      JSON.stringify({
        defaultPresets: ['docs'],
        sets: [
          {
            package: PKG_NAME,
            selector: { files: ['docs/guide.md'] },
            output: { path: defaultOutput, gitignore: false },
            presets: ['docs'],
          },
          {
            package: PKG_NAME,
            selector: { files: ['docs/api.md'] },
            output: { path: allOutput, gitignore: false },
            presets: ['api'],
          },
        ],
      }),
    );

    await cli(['node', 'filedist', 'extract', '--config', configFile, '--all'], tmpDir);

    expect(fs.existsSync(path.join(defaultOutput, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(allOutput, 'docs/api.md'))).toBe(true);
  }, 60_000);

  it('returns a clear error when config still uses legacy postExtractScript', async () => {
    const configFile = path.join(tmpDir, 'legacy-post-extract.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        postExtractScript: ['node', 'scripts/post-extract.js'],
        sets: [{ package: PKG_NAME, output: { path: './output', gitignore: false } }],
      }),
    );

    const errors: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
    const code = await cli(['node', 'filedist', 'extract', '--config', configFile], tmpDir);
    spy.mockRestore();

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('"postExtractScript" was renamed to "postExtractCmd"');
  });

  it('returns a clear error when postExtractCmd is configured as a shell string', async () => {
    const configFile = path.join(tmpDir, 'invalid-post-extract.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        postExtractCmd: 'node scripts/post-extract.js',
        sets: [{ package: PKG_NAME, output: { path: './output', gitignore: false } }],
      }),
    );

    const errors: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
    const code = await cli(['node', 'filedist', 'extract', '--config', configFile], tmpDir);
    spy.mockRestore();

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('"postExtractCmd" must be an array of strings');
    expect(errors.join('\n')).toContain(
      'Shell strings like "node scripts/post-extract.js" are not supported.',
    );
  });
});
