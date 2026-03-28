import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeMarker, markerPath } from '../fileset/markers';
import { addToGitignore } from '../fileset/gitignore';
import { ResolvedFile } from '../types';

import { calculateDiff } from './calculate-diff';

describe('calculateDiff', () => {
  let tmpDir: string;
  let outputDir: string;
  let pkgDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-calculate-diff-'));
    outputDir = path.join(tmpDir, 'output');
    pkgDir = path.join(tmpDir, 'pkg');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(pkgDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeFile = (dir: string, relPath: string, content: string): void => {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };

  const buildResolvedFile = (
    relPath: string,
    overrides: Partial<ResolvedFile> = {},
  ): ResolvedFile => ({
    relPath,
    sourcePath: path.join(pkgDir, relPath),
    packageName: 'test-pkg',
    packageVersion: '1.0.0',
    outputDir,
    managed: true,
    gitignore: false,
    force: false,
    ignoreIfExisting: false,
    noSync: false,
    contentReplacements: [],
    symlinks: [],
    ...overrides,
  });

  it('returns empty result for empty resolved files', async () => {
    const result = await calculateDiff([], false);
    expect(result.ok).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
    expect(result.conflict).toHaveLength(0);
  });

  it('classifies missing file when not present in output', async () => {
    writeFile(pkgDir, 'guide.md', '# Guide');
    const resolved = [buildResolvedFile('guide.md')];

    const result = await calculateDiff(resolved, false);

    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].relPath).toBe('guide.md');
    expect(result.ok).toHaveLength(0);
  });

  it('classifies ok when content and managed/gitignore state match', async () => {
    writeFile(pkgDir, 'guide.md', '# Guide');
    writeFile(outputDir, 'guide.md', '# Guide');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
    ]);

    const resolved = [buildResolvedFile('guide.md', { managed: true, gitignore: false })];

    const result = await calculateDiff(resolved, false);

    expect(result.ok).toHaveLength(1);
    expect(result.ok[0].relPath).toBe('guide.md');
    expect(result.conflict).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('classifies conflict when content differs', async () => {
    writeFile(pkgDir, 'guide.md', 'NEW content');
    writeFile(outputDir, 'guide.md', 'OLD content');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
    ]);

    const resolved = [buildResolvedFile('guide.md')];

    const result = await calculateDiff(resolved, false);

    expect(result.conflict).toHaveLength(1);
    expect(result.conflict[0].relPath).toBe('guide.md');
    expect(result.conflict[0].conflictReasons).toContain('content');
  });

  it('classifies conflict when managed state mismatches (file exists but not in marker)', async () => {
    writeFile(pkgDir, 'guide.md', '# Guide');
    writeFile(outputDir, 'guide.md', '# Guide'); // exists on disk but NOT in marker

    // No marker entry → file is not managed

    const resolved = [buildResolvedFile('guide.md', { managed: true })];

    const result = await calculateDiff(resolved, false);

    expect(result.conflict).toHaveLength(1);
    expect(result.conflict[0].conflictReasons).toContain('managed');
  });

  it('classifies conflict when gitignore state mismatches (desired gitignore=true but not in .gitignore)', async () => {
    writeFile(pkgDir, 'guide.md', '# Guide');
    writeFile(outputDir, 'guide.md', '# Guide');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
    ]);
    // No gitignore entry

    const resolved = [buildResolvedFile('guide.md', { gitignore: true })];

    const result = await calculateDiff(resolved, false);

    expect(result.conflict).toHaveLength(1);
    expect(result.conflict[0].conflictReasons).toContain('gitignore');
  });

  it('classifies ok when gitignore=true and file IS in .gitignore', async () => {
    writeFile(pkgDir, 'guide.md', '# Guide');
    writeFile(outputDir, 'guide.md', '# Guide');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
    ]);
    await addToGitignore(outputDir, ['guide.md']);

    const resolved = [buildResolvedFile('guide.md', { gitignore: true })];

    const result = await calculateDiff(resolved, false);

    expect(result.ok).toHaveLength(1);
    expect(result.conflict).toHaveLength(0);
  });

  it('classifies extra when managed file in marker is not in desired files', async () => {
    writeFile(outputDir, 'stale.md', 'stale content');
    await writeMarker(markerPath(outputDir), [
      { path: 'stale.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
    ]);

    // Desired files don't include stale.md
    writeFile(pkgDir, 'current.md', '# Current');
    const resolved = [buildResolvedFile('current.md')];

    const result = await calculateDiff(resolved, false);

    expect(result.extra).toHaveLength(1);
    expect(result.extra[0].relPath).toBe('stale.md');
  });

  it('does not classify extra files from different packages', async () => {
    writeFile(outputDir, 'pkg-a.md', 'aaa');
    writeFile(outputDir, 'pkg-b.md', 'bbb');

    // Marker has both packages
    await writeMarker(markerPath(outputDir), [
      { path: 'pkg-a.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
      { path: 'pkg-b.md', packageName: 'other-pkg', packageVersion: '1.0.0' },
    ]);

    // Desired files only from test-pkg
    writeFile(pkgDir, 'pkg-a.md', 'aaa');
    const resolved = [buildResolvedFile('pkg-a.md', { managed: true, gitignore: false })];

    const result = await calculateDiff(resolved, false);

    // pkg-b.md belongs to other-pkg which is NOT in relevantPackages → not extra
    const extraPaths = result.extra.map((e) => e.relPath);
    expect(extraPaths).not.toContain('pkg-b.md');
  });

  it('classifies extra for relevant packages even when desired managed files are empty', async () => {
    writeFile(outputDir, 'stale-eslint.js', 'module.exports = {};');
    await writeMarker(markerPath(outputDir), [
      { path: 'stale-eslint.js', packageName: 'eslint', packageVersion: '8.0.0' },
    ]);

    const relevantPackagesByOutputDir = new Map([[outputDir, new Set(['eslint'])]]);

    const result = await calculateDiff([], false, '', relevantPackagesByOutputDir);

    expect(result.extra).toHaveLength(1);
    expect(result.extra[0].relPath).toBe('stale-eslint.js');
  });

  it('handles multiple output directories independently', async () => {
    const outputDir2 = path.join(tmpDir, 'output2');
    fs.mkdirSync(outputDir2, { recursive: true });

    writeFile(pkgDir, 'file1.md', '# 1');
    writeFile(pkgDir, 'file2.md', '# 2');
    writeFile(outputDir, 'file1.md', '# 1');
    // file2 missing from outputDir2

    await writeMarker(markerPath(outputDir), [
      { path: 'file1.md', packageName: 'test-pkg', packageVersion: '1.0.0' },
    ]);

    const srcPath2 = path.join(pkgDir, 'file2.md');
    const resolved = [
      buildResolvedFile('file1.md', { managed: true, gitignore: false }),
      {
        relPath: 'file2.md',
        sourcePath: srcPath2,
        packageName: 'test-pkg',
        packageVersion: '1.0.0',
        outputDir: outputDir2,
        managed: true,
        gitignore: false,
        force: false,
        ignoreIfExisting: false,
        noSync: false,
        contentReplacements: [],
        symlinks: [],
      } satisfies ResolvedFile,
    ];

    const result = await calculateDiff(resolved, false);

    expect(result.ok.some((e) => e.relPath === 'file1.md')).toBe(true);
    expect(result.missing.some((e) => e.relPath === 'file2.md' && e.outputDir === outputDir2)).toBe(
      true,
    );
  });
});
