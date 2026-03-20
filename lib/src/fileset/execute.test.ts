import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ExtractionMap, ManagedFileMetadata } from '../types';

import { execute, rollback, deleteFiles } from './execute';
import { readMarker } from './markers';
import { MARKER_FILE, GITIGNORE_FILE } from './constants';

describe('execute', () => {
  let tmpDir: string;
  let pkgDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-execute-test-'));
    pkgDir = path.join(tmpDir, 'pkg');
    outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    // Make all files writable before cleanup
    try {
      fs.chmodSync(outputDir, 0o755);
    } catch {
      /* ignore */
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  const writeFile = (dir: string, relPath: string, content: string): string => {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return fullPath;
  };

  const makeMap = (overrides?: Partial<ExtractionMap>): ExtractionMap => ({
    toAdd: [],
    toModify: [],
    toDelete: [],
    toSkip: [],
    conflicts: [],
    ...overrides,
  });

  it('writes toAdd files to outputDir', async () => {
    const srcPath = writeFile(pkgDir, 'docs/guide.md', '# Guide');
    const destPath = path.join(outputDir, 'docs/guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'docs/guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(map, outputDir, { path: '.' }, { name: 'my-pkg' }, '1.0.0', [], tmpDir);

    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf8')).toBe('# Guide');
  });

  it('makes written files read-only (managed mode)', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    const stat = fs.statSync(destPath);

    expect(stat.mode & 0o200).toBe(0); // no write bit
  });

  it('updates .npmdata marker file', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    const marker = await readMarker(path.join(outputDir, MARKER_FILE));
    expect(marker).toHaveLength(1);
    expect(marker[0].path).toBe('guide.md');
    expect(marker[0].packageName).toBe('my-pkg');
    expect(marker[0].packageVersion).toBe('1.0.0');
  });

  it('updates .gitignore when gitignore is not disabled', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: true },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    const gitignoreContent = fs.readFileSync(path.join(outputDir, GITIGNORE_FILE), 'utf8');
    expect(gitignoreContent).toContain('guide.md');
  });

  it('does not write files in dryRun mode', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', dryRun: true },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    expect(fs.existsSync(destPath)).toBe(false);
  });

  it('makes dest file writable before overwriting when toAdd dest already exists', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# NewContent');
    const destPath = path.join(outputDir, 'guide.md');
    // Pre-create the destination as read-only
    fs.writeFileSync(destPath, '# Old');
    fs.chmodSync(destPath, 0o444);

    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    expect(fs.readFileSync(destPath, 'utf8')).toBe('# NewContent');
  });

  it('does not write marker or gitignore in dryRun mode', async () => {
    const srcPath = writeFile(pkgDir, 'guide.md', '# Guide');
    const destPath = path.join(outputDir, 'guide.md');
    const map = makeMap({
      toAdd: [{ relPath: 'guide.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', dryRun: true, gitignore: true },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
    );

    expect(fs.existsSync(path.join(outputDir, MARKER_FILE))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, GITIGNORE_FILE))).toBe(false);
  });

  it('preserves existing marker entries from other packages', async () => {
    const srcPath = writeFile(pkgDir, 'new.md', 'new');
    const destPath = path.join(outputDir, 'new.md');
    const existingMarker: ManagedFileMetadata[] = [
      { path: 'other.md', packageName: 'other-pkg', packageVersion: '1.0.0' },
    ];
    const map = makeMap({
      toAdd: [{ relPath: 'new.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      { path: '.', gitignore: false },
      { name: 'my-pkg' },
      '1.0.0',
      existingMarker,
      tmpDir,
    );

    const marker = await readMarker(path.join(outputDir, MARKER_FILE));
    expect(marker).toHaveLength(2);
    const names = marker.map((m) => m.path);
    expect(names).toContain('other.md');
    expect(names).toContain('new.md');
  });

  it('verbose mode logs add, modify, marker and gitignore steps', async () => {
    const srcPath = writeFile(pkgDir, 'verbose-add.md', '# Add');
    const destPath = path.join(outputDir, 'verbose-add.md');
    const modSrcPath = writeFile(pkgDir, 'verbose-mod.md', '# Modified');
    const modDestPath = path.join(outputDir, 'verbose-mod.md');
    // Pre-create modifiable destination
    fs.writeFileSync(modDestPath, '# Old');
    fs.chmodSync(modDestPath, 0o644);

    const map = makeMap({
      toAdd: [{ relPath: 'verbose-add.md', sourcePath: srcPath, destPath, hash: 'abc' }],
      toModify: [
        { relPath: 'verbose-mod.md', sourcePath: modSrcPath, destPath: modDestPath, hash: 'xyz' },
      ],
    });

    // Execute with verbose=true and gitignore=true to exercise all verbose branches
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(jest.fn());
    try {
      await execute(
        map,
        outputDir,
        { path: '.', gitignore: true },
        { name: 'my-pkg' },
        '1.0.0',
        [],
        tmpDir,
        true, // verbose
      );

      expect(fs.existsSync(destPath)).toBe(true);
      expect(fs.readFileSync(modDestPath, 'utf8')).toBe('# Modified');

      const logs = consoleSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(logs).toContain('[verbose] execute: adding file output/verbose-add.md');
      expect(logs).toContain('[verbose] execute: modifying file output/verbose-mod.md');
      expect(logs).toContain('[verbose] execute: writing marker file at output/.npmdata');
      expect(logs).not.toContain(destPath);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('verbose mode logs content replacement step', async () => {
    const srcPath = writeFile(pkgDir, 'replace-me.md', 'Hello TOKEN world');
    const destPath = path.join(outputDir, 'replace-me.md');

    const map = makeMap({
      toAdd: [{ relPath: 'replace-me.md', sourcePath: srcPath, destPath, hash: 'abc' }],
    });

    await execute(
      map,
      outputDir,
      {
        path: '.',
        gitignore: false,
        contentReplacements: [{ files: '**', match: 'TOKEN', replace: 'DONE' }],
      },
      { name: 'my-pkg' },
      '1.0.0',
      [],
      tmpDir,
      true, // verbose
    );

    expect(fs.readFileSync(destPath, 'utf8')).toContain('DONE');
  });
});

describe('rollback', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-rollback-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('deletes newly created files', async () => {
    const file = path.join(tmpDir, 'new-file.md');
    fs.writeFileSync(file, 'content');
    await rollback([file]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('ignores files that do not exist', async () => {
    await expect(rollback([path.join(tmpDir, 'nonexistent.md')])).resolves.toBeUndefined();
  });
});

describe('deleteFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-deletefiles-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes existing files verbosely', async () => {
    const file = path.join(tmpDir, 'to-delete.md');
    fs.writeFileSync(file, 'content');
    await deleteFiles([file], true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('skips non-existent files without error', async () => {
    await expect(deleteFiles([path.join(tmpDir, 'ghost.md')], true)).resolves.toBeUndefined();
  });
});
