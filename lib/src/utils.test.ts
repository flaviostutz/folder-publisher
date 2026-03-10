/* eslint-disable no-undefined */
import fs from 'node:fs';
import os from 'node:os';
import childProcess from 'node:child_process';
import path from 'node:path';

import {
  parsePackageSpec,
  hashFile,
  hashBuffer,
  hashFileSync,
  isBinaryFile,
  filterEntriesByPresets,
  ensureDir,
  getInstalledPackagePath,
  getInstalledIfSatisfies,
  installOrUpgradePackage,
} from './utils';

describe('parsePackageSpec', () => {
  it('parses a plain package name', () => {
    expect(parsePackageSpec('my-pkg')).toEqual({ name: 'my-pkg', version: undefined });
  });

  it('parses a package with a version', () => {
    expect(parsePackageSpec('my-pkg@^1.2.3')).toEqual({ name: 'my-pkg', version: '^1.2.3' });
  });

  it('parses a scoped package name without version', () => {
    expect(parsePackageSpec('@scope/my-pkg')).toEqual({
      name: '@scope/my-pkg',

      version: undefined,
    });
  });

  it('parses a scoped package name with version', () => {
    expect(parsePackageSpec('@scope/my-pkg@2.x')).toEqual({
      name: '@scope/my-pkg',
      version: '2.x',
    });
  });

  it('handles empty version after @', () => {
    expect(parsePackageSpec('my-pkg@')).toEqual({ name: 'my-pkg', version: undefined });
  });
});

describe('hashFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns a hex SHA-256 hash of the file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const hash = await hashFile(filePath);
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });

  it('returns different hashes for files with different content', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fileA, 'content A');
    fs.writeFileSync(fileB, 'content B');
    const hashA = await hashFile(fileA);
    const hashB = await hashFile(fileB);
    expect(hashA).not.toBe(hashB);
  });

  it('returns the same hash for files with identical content', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(fileA, 'same content');
    fs.writeFileSync(fileB, 'same content');
    const hashA = await hashFile(fileA);
    const hashB = await hashFile(fileB);
    expect(hashA).toBe(hashB);
  });
});

describe('hashFileSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-hashsync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns a hex SHA-256 hash synchronously', () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const hash = hashFileSync(filePath);
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });

  it('matches the async hashFile result', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello');
    const syncHash = hashFileSync(filePath);
    const asyncHash = await hashFile(filePath);
    expect(syncHash).toBe(asyncHash);
  });
});

describe('hashBuffer', () => {
  it('returns the SHA-256 hash of a string', () => {
    const hash = hashBuffer('hello world');
    expect(hash).toMatch(/^[\da-f]{64}$/);
  });

  it('returns the same hash for identical strings', () => {
    expect(hashBuffer('abc')).toBe(hashBuffer('abc'));
  });
});

describe('isBinaryFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-binary-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for a text file', () => {
    const filePath = path.join(tmpDir, 'text.md');
    fs.writeFileSync(filePath, '# Hello World\nThis is text.');
    expect(isBinaryFile(filePath)).toBe(false);
  });

  it('returns true for a file containing null bytes', () => {
    const filePath = path.join(tmpDir, 'binary.bin');
    // Write a buffer with a null byte (0x00) which marks binary files
    const buf = Buffer.alloc(4);
    buf.writeUInt8(72, 0); // H
    buf.writeUInt8(0, 1); // null byte — indicates binary
    buf.writeUInt8(105, 2); // i
    buf.writeUInt8(33, 3); // !
    fs.writeFileSync(filePath, buf);
    expect(isBinaryFile(filePath)).toBe(true);
  });

  it('returns false for a nonexistent file (catch branch)', () => {
    expect(isBinaryFile('/nonexistent/file')).toBe(false);
  });
});

describe('filterEntriesByPresets', () => {
  const baseEntry = { package: 'pkg@1.0.0', output: { path: 'out' } };

  it('returns all entries when presets list is empty', () => {
    const entries = [baseEntry, { ...baseEntry, package: 'pkg2@1.0.0' }];
    expect(filterEntriesByPresets(entries, [])).toEqual(entries);
  });

  it('returns only entries whose presets include the requested tag', () => {
    const entries = [
      { ...baseEntry, selector: { presets: ['docs'] } },
      { ...baseEntry, package: 'pkg2@1.0.0', selector: { presets: ['data'] } },
    ];
    expect(filterEntriesByPresets(entries, ['docs'])).toHaveLength(1);
    expect(filterEntriesByPresets(entries, ['docs'])[0].selector?.presets).toContain('docs');
  });

  it('excludes entries with no presets when a preset filter is applied', () => {
    const entries = [{ ...baseEntry }, { ...baseEntry, selector: { presets: ['docs'] } }];
    expect(filterEntriesByPresets(entries, ['docs'])).toHaveLength(1);
  });

  it('matches any of multiple requested preset tags', () => {
    const entries = [
      { ...baseEntry, selector: { presets: ['docs'] } },
      { ...baseEntry, package: 'pkg2@1.0.0', selector: { presets: ['data'] } },
    ];
    expect(filterEntriesByPresets(entries, ['docs', 'data'])).toHaveLength(2);
  });
});

describe('ensureDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ensuredir-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a directory that does not exist', () => {
    const myDir = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(myDir);
    expect(fs.existsSync(myDir)).toBe(true);
  });

  it('does nothing when the directory already exists', () => {
    ensureDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);
  });
});

describe('getInstalledPackagePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-installed-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when the package is not installed', () => {
    expect(getInstalledPackagePath('nonexistent-pkg', tmpDir)).toBeNull();
  });

  it('returns the package directory when package.json exists under node_modules', () => {
    const pkgDir = path.join(tmpDir, 'node_modules', 'my-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"my-pkg"}');
    expect(getInstalledPackagePath('my-pkg', tmpDir)).toBe(pkgDir);
  });
});

describe('getInstalledIfSatisfies', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-satisfies-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when package is not installed', () => {
    expect(getInstalledIfSatisfies('missing-pkg', '1.0.0', tmpDir)).toBeNull();
  });

  describe('integrated – real node_modules', () => {
    // projectRoot is the lib/ folder where node_modules actually lives
    const projectRoot = path.resolve(__dirname, '..');

    it('finds semver when the installed version satisfies ^7.0.0', () => {
      const result = getInstalledIfSatisfies('semver', '^7.0.0', projectRoot);
      expect(result).toBe(path.join(projectRoot, 'node_modules', 'semver'));
    });

    it('finds semver with no version constraint', () => {
      const result = getInstalledIfSatisfies('semver', undefined, projectRoot);
      expect(result).toBe(path.join(projectRoot, 'node_modules', 'semver'));
    });

    it('returns null when requesting a version that the installed semver does not satisfy', () => {
      // semver 7.x is installed; require 6.x should not match
      const result = getInstalledIfSatisfies('semver', '^6.0.0', projectRoot);
      expect(result).toBeNull();
    });

    it('returns null for a package that is not in node_modules at all', () => {
      const result = getInstalledIfSatisfies('__definitely-not-installed__', '1.0.0', projectRoot);
      expect(result).toBeNull();
    });
  });
});

describe('installPackage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-installpkg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns cached path when package already installed and upgrade is false', async () => {
    const pkgDir = path.join(tmpDir, 'node_modules', 'cached-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"cached-pkg","version":"1.0.0"}');
    const result = await installOrUpgradePackage('cached-pkg', '1.0.0', false, tmpDir);
    expect(result).toBe(pkgDir);
  });

  it('throws an Error with detail when execSync fails', async () => {
    // Attempt to install a definitely-nonexistent package so execSync fails
    await expect(
      installOrUpgradePackage('__nonexistent_pkg_xyz_abc__', '0.0.1', true, tmpDir),
    ).rejects.toThrow(/Failed to install/);
  });

  it('throws a clear error when install succeeds but package not found in node_modules', async () => {
    // Simulate a scenario where execSync ran fine but no node_modules/<pkg> was created.
    // We spy on execSync to be a no-op (so it "succeeds" without creating anything).
    const { execSync: realExecSync } =
      jest.requireActual<typeof import('node:child_process')>('node:child_process');
    const spy = jest.spyOn(childProcess, 'execSync').mockReturnValueOnce('');
    try {
      await expect(installOrUpgradePackage('ghost-pkg', '1.0.0', true, tmpDir)).rejects.toThrow(
        /was not found.*after installation.*package\.json/i,
      );
    } finally {
      spy.mockRestore();
      void realExecSync; // suppress unused warning
    }
  });

  it('creates package.json when it does not exist before installing', async () => {
    // No package.json in tmpDir initially
    expect(fs.existsSync(path.join(tmpDir, 'package.json'))).toBe(false);
    // Spy captures whether package.json already exists when execSync is called
    let pkgJsonExistedDuringInstall = false;
    const spy = jest.spyOn(childProcess, 'execSync').mockImplementationOnce(() => {
      pkgJsonExistedDuringInstall = fs.existsSync(path.join(tmpDir, 'package.json'));
      return '';
    });
    try {
      // upgrade=true skips cache; execSync no-op means node_modules/<pkg> won't appear → throws
      await expect(installOrUpgradePackage('some-pkg', '1.0.0', true, tmpDir)).rejects.toThrow(
        /was not found.*after installation/i,
      );
      expect(pkgJsonExistedDuringInstall).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'package.json'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
