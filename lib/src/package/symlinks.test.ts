import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  collectManagedSymlinkEntries,
  createSymlinks,
  removeAllSymlinks,
  removeStaleSymlinks,
} from './symlinks';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-symlinks-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createSymlinks', () => {
  it('creates a symlink in the target directory for each matched source', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'README.md'), '# hi');

    const targetDir = path.join(tmpDir, 'links');
    await createSymlinks(outputDir, [{ source: 'docs/README.md', target: '../links' }]);

    const linkPath = path.join(targetDir, 'README.md');
    expect(fs.existsSync(linkPath)).toBe(true);
    const stat = fs.lstatSync(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('overwrites an existing symlink', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'file.md'), 'v1');

    const targetDir = path.join(tmpDir, 'links');
    fs.mkdirSync(targetDir, { recursive: true });
    const linkPath = path.join(targetDir, 'file.md');
    fs.symlinkSync('/dev/null', linkPath);

    await createSymlinks(outputDir, [{ source: 'docs/file.md', target: '../links' }]);
    const target = fs.readlinkSync(linkPath);
    expect(target).not.toBe('/dev/null');
  });

  it('no-ops on empty configs', async () => {
    await expect(createSymlinks(tmpDir, [])).resolves.toBeUndefined();
  });
});

describe('removeStaleSymlinks', () => {
  it('removes only managed symlinks that are no longer desired', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });

    const targetDir = path.join(outputDir, 'links');
    fs.mkdirSync(targetDir, { recursive: true });

    // Create a stale symlink (source file no longer matches)
    const staleLink = path.join(targetDir, 'old.md');
    fs.symlinkSync('/dev/null', staleLink);
    const unmanagedLink = path.join(targetDir, 'keep-unmanaged.md');
    fs.symlinkSync('/dev/null', unmanagedLink);

    const removed = await removeStaleSymlinks(
      outputDir,
      [{ path: 'links/old.md', packageName: 'pkg', packageVersion: '1.0.0', kind: 'symlink' }],
      new Set(),
    );

    // Stale symlink should be removed
    expect(fs.existsSync(staleLink)).toBe(false);
    expect(fs.existsSync(unmanagedLink)).toBe(true);
    expect(removed).toEqual(['links/old.md']);
  });

  it('keeps managed symlinks that are still desired', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'keep.md'), '# keep');

    const targetDir = path.join(outputDir, 'links');
    fs.mkdirSync(targetDir, { recursive: true });

    const keepLink = path.join(targetDir, 'keep.md');
    const relTarget = path.relative(targetDir, path.join(outputDir, 'docs', 'keep.md'));
    fs.symlinkSync(relTarget, keepLink);

    const removed = await removeStaleSymlinks(
      outputDir,
      [{ path: 'links/keep.md', packageName: 'pkg', packageVersion: '1.0.0', kind: 'symlink' }],
      new Set(['links/keep.md']),
    );

    expect(fs.existsSync(keepLink) || fs.lstatSync(keepLink).isSymbolicLink()).toBe(true);
    expect(removed).toEqual([]);
  });
});

describe('collectManagedSymlinkEntries', () => {
  it('returns marker entries for managed symlinks only', () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs', 'guide.md'), '# guide');

    const entries = collectManagedSymlinkEntries(outputDir, [
      {
        relPath: 'docs/guide.md',
        sourcePath: path.join(tmpDir, 'pkg', 'docs', 'guide.md'),
        packageName: 'pkg',
        packageVersion: '1.0.0',
        outputDir,
        managed: true,
        gitignore: false,
        force: false,
        ignoreIfExisting: false,
        noSync: false,
        contentReplacements: [],
        symlinks: [{ source: 'docs/*.md', target: 'links' }],
      },
      {
        relPath: 'docs/guide.md',
        sourcePath: path.join(tmpDir, 'pkg', 'docs', 'guide.md'),
        packageName: 'pkg',
        packageVersion: '1.0.0',
        outputDir,
        managed: false,
        gitignore: false,
        force: false,
        ignoreIfExisting: false,
        noSync: false,
        contentReplacements: [],
        symlinks: [{ source: 'docs/*.md', target: 'other-links' }],
      },
    ]);

    expect(entries).toEqual([
      {
        path: 'links/guide.md',
        packageName: 'pkg',
        packageVersion: '1.0.0',
        kind: 'symlink',
      },
    ]);
  });
});

describe('removeAllSymlinks', () => {
  it('removes all symlinks pointing into the outputDir', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'target.md'), '# target');

    const linksDir = path.join(outputDir, 'links');
    fs.mkdirSync(linksDir, { recursive: true });

    const relTarget = path.relative(linksDir, path.join(outputDir, 'target.md'));
    fs.symlinkSync(relTarget, path.join(linksDir, 'link.md'));

    const count = await removeAllSymlinks(outputDir);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 when directory does not exist', async () => {
    const count = await removeAllSymlinks(path.join(tmpDir, 'nonexistent'));
    expect(count).toBe(0);
  });

  it('skips symlinks NOT pointing into outputDir', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Create a symlink that points outside outputDir
    const externalTarget = path.join(tmpDir, 'external.md');
    fs.writeFileSync(externalTarget, '# external');
    fs.symlinkSync(externalTarget, path.join(outputDir, 'external-link.md'));

    const count = await removeAllSymlinks(outputDir);
    // The symlink to external target should not be removed
    expect(count).toBe(0);
    expect(fs.existsSync(path.join(outputDir, 'external-link.md'))).toBe(true);
  });

  it('recurses into subdirectories to find and remove symlinks', async () => {
    const outputDir = path.join(tmpDir, 'out');
    const subDir = path.join(outputDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'target.txt'), 'hello');

    // Symlink inside subDir pointing to outputDir file
    const relTarget = path.relative(subDir, path.join(outputDir, 'target.txt'));
    fs.symlinkSync(relTarget, path.join(subDir, 'link.txt'));

    const count = await removeAllSymlinks(outputDir);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(subDir, 'link.txt'))).toBe(false);
  });
});
