import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installedPackagePath, enumeratePackageFiles } from './package-files';
import { installMockPackage } from './test-utils';

describe('installedPackagePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-pkgfiles-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns null when package is not installed', () => {
    expect(installedPackagePath('nonexistent-pkg', tmpDir)).toBeNull();
  });

  it('returns the package path when installed', async () => {
    await installMockPackage('my-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    const result = installedPackagePath('my-pkg', tmpDir);
    expect(result).toBeTruthy();
    expect(result).toContain('my-pkg');
    expect(fs.existsSync(result!)).toBe(true);
  }, 60000);
});

describe('enumeratePackageFiles', () => {
  let tmpDir: string;
  let pkgPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-enumerate-test-'));
    pkgPath = await installMockPackage(
      'test-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        'docs/api.md': 'API docs with keyword: hello',
        'README.md': '# Test',
        'package.json': '{"name":"test-pkg"}',
        'bin/run.js': '#!/usr/bin/env node',
        'src/index.ts': 'export const x = 1;',
        'data/binary.bin': Buffer.from([0x00, 0x01, 0x02]).toString(),
      },
      tmpDir,
    );
  }, 60000);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('applies default file patterns (excludes package.json, bin/, README.md)', async () => {
    const files = await enumeratePackageFiles(pkgPath, {});
    expect(files).toContain('docs/guide.md');
    expect(files).toContain('src/index.ts');
    expect(files).not.toContain('package.json');
    expect(files).not.toContain('bin/run.js');
    expect(files).not.toContain('README.md');
  });

  it('applies custom glob filter', async () => {
    const files = await enumeratePackageFiles(pkgPath, { files: ['docs/**'] });
    expect(files).toContain('docs/guide.md');
    expect(files).toContain('docs/api.md');
    expect(files).not.toContain('src/index.ts');
  });

  it('returns empty array when files is an explicit empty list', async () => {
    const files = await enumeratePackageFiles(pkgPath, { files: [] });
    expect(files).toHaveLength(0);
  });

  it('applies contentRegexes filter', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['**'],
      contentRegexes: ['hello'],
    });
    expect(files).toContain('docs/api.md');
    expect(files).not.toContain('docs/guide.md');
    expect(files).not.toContain('src/index.ts');
  });

  it('does not exclude binary files when contentRegexes are set', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['data/**'],
      contentRegexes: ['somepattern'],
    });
    // Binary files pass through (cannot be scanned but may be legitimately needed)
    expect(files).toContain('data/binary.bin');
  });

  it('applies exclude patterns to omit matched files', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['**/*.md'],
      exclude: ['docs/**'],
    });
    // README.md is excluded by DEFAULT_EXCLUDE_PATTERNS; docs/** by the custom exclude
    expect(files).not.toContain('README.md');
    expect(files).not.toContain('docs/guide.md');
    expect(files).not.toContain('docs/api.md');
  });

  it('still applies default exclusions when exclude is empty', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['**/*.md'],
      exclude: [],
    });
    expect(files).toContain('docs/guide.md');
    expect(files).toContain('docs/api.md');
    // README.md is excluded by DEFAULT_EXCLUDE_PATTERNS even though exclude: []
    expect(files).not.toContain('README.md');
  });

  it('removes a default exclusion when its pattern is listed exactly in files', async () => {
    // README.md is in DEFAULT_EXCLUDE_PATTERNS; listing it explicitly in files should un-exclude it
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['README.md', '**/*.md'],
    });
    expect(files).toContain('README.md');
    expect(files).toContain('docs/guide.md');
  });

  it('exclude takes precedence over files match', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      files: ['**/*.md'],
      exclude: ['**/*.md'],
    });
    expect(files).toHaveLength(0);
  });

  it('returns empty array when selector has only presets (no files)', async () => {
    // presets is purely a set-level filter; without an explicit files pattern no
    // direct files should be enumerated from the package.
    const files = await enumeratePackageFiles(pkgPath, { presets: ['docs'] });
    expect(files).toHaveLength(0);
  });

  it('enumerates files normally when both presets and files are specified', async () => {
    const files = await enumeratePackageFiles(pkgPath, {
      presets: ['docs'],
      files: ['docs/**'],
    });
    expect(files).toContain('docs/guide.md');
    expect(files).toContain('docs/api.md');
  });
});
