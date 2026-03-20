/* eslint-disable no-undefined */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { writeMarker, markerPath } from '../fileset/markers';
import { addToGitignore } from '../fileset/gitignore';
import { installMockPackage } from '../fileset/test-utils';
import { NpmdataExtractEntry, ProgressEvent } from '../types';
import { filterEntriesByPresets } from '../utils';

import { actionPurge } from './action-purge';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-action-purge-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionPurge', () => {
  it('deletes managed files for matching package', async () => {
    await installMockPackage('mypkg', '1.0.0', { 'guide.md': '# h' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), '# h');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({ entries, cwd: tmpDir });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'guide.md'))).toBe(false);
  }, 60_000);

  it('dry-run counts but does not delete', async () => {
    await installMockPackage('mypkg', '1.0.0', { 'guide.md': '# h' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), '# h');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({ entries, cwd: tmpDir, dryRun: true });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'guide.md'))).toBe(true);
  }, 60_000);

  it('only purges files for the matching package', async () => {
    await installMockPackage('pkg-a', '1.0.0', { 'a.md': 'aaa' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'a.md'), 'aaa');
    fs.writeFileSync(path.join(outputDir, 'b.md'), 'bbb');

    await writeMarker(markerPath(outputDir), [
      { path: 'a.md', packageName: 'pkg-a', packageVersion: '1.0.0' },
      { path: 'b.md', packageName: 'pkg-b', packageVersion: '1.0.0' },
    ]);

    // Only purge pkg-a
    const entries: NpmdataExtractEntry[] = [
      { package: 'pkg-a@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({ entries, cwd: tmpDir });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'a.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'b.md'))).toBe(true);
  }, 60_000);

  it('respects preset filtering', async () => {
    await installMockPackage('pkg-a', '1.0.0', { 'a.md': 'a' }, tmpDir);

    const outA = path.join(tmpDir, 'out-a');
    const outB = path.join(tmpDir, 'out-b');
    fs.mkdirSync(outA, { recursive: true });
    fs.mkdirSync(outB, { recursive: true });
    fs.writeFileSync(path.join(outA, 'a.md'), 'a');
    fs.writeFileSync(path.join(outB, 'b.md'), 'b');

    await writeMarker(markerPath(outA), [
      { path: 'a.md', packageName: 'pkg-a', packageVersion: '1.0.0' },
    ]);
    await writeMarker(markerPath(outB), [
      { path: 'b.md', packageName: 'pkg-b', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'pkg-a@1.0.0', output: { path: outA }, presets: ['preset-a'] },
      { package: 'pkg-b@1.0.0', output: { path: outB }, presets: ['preset-b'] },
    ];

    // Only process preset-a
    const filteredEntries = filterEntriesByPresets(entries, ['preset-a']);
    const result = await actionPurge({ entries: filteredEntries, cwd: tmpDir });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outA, 'a.md'))).toBe(false);
    expect(fs.existsSync(path.join(outB, 'b.md'))).toBe(true);
  }, 60_000);

  it('emits progress events', async () => {
    await installMockPackage('mypkg', '1.0.0', { 'guide.md': '# h' }, tmpDir);

    const events: string[] = [];
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), '# h');

    await writeMarker(markerPath(outputDir), [
      { path: 'guide.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    await actionPurge({
      entries,
      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
    expect(events).toContain('package-end');
  }, 60_000);

  it('emits file-deleted events for each purged file', async () => {
    await installMockPackage('mypkg', '1.0.0', { 'notes.md': 'notes' }, tmpDir);

    const events: Array<{ type: string; file?: string }> = [];
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'notes.md'), 'notes');

    await writeMarker(markerPath(outputDir), [
      { path: 'notes.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    await actionPurge({
      entries,
      cwd: tmpDir,
      onProgress: (e) => events.push({ type: e.type, file: 'file' in e ? e.file : undefined }),
    });

    const fileDeleted = events.find((e) => e.type === 'file-deleted');
    expect(fileDeleted).toBeDefined();
  }, 60_000);

  it('emits managed and gitignore metadata on file-deleted events', async () => {
    await installMockPackage('mypkg-flags', '1.0.0', { 'notes.md': 'notes' }, tmpDir);

    const events: ProgressEvent[] = [];
    const outputDir = path.join(tmpDir, 'out-flags');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'notes.md'), 'notes');

    await writeMarker(markerPath(outputDir), [
      { path: 'notes.md', packageName: 'mypkg-flags', packageVersion: '1.0.0' },
    ]);
    await addToGitignore(outputDir, ['notes.md']);

    await actionPurge({
      entries: [{ package: 'mypkg-flags@1.0.0', output: { path: outputDir } }],
      cwd: tmpDir,
      onProgress: (e) => events.push(e),
    });

    const fileDeleted = events.find((e) => e.type === 'file-deleted');
    expect(fileDeleted).toMatchObject({
      type: 'file-deleted',
      file: 'notes.md',
      managed: true,
      gitignore: true,
    });
  }, 60_000);

  it('verbose mode logs without errors', async () => {
    await installMockPackage('verbose-pkg', '1.0.0', { 'verbose.md': 'content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'verbose.md'), 'content');

    await writeMarker(markerPath(outputDir), [
      { path: 'verbose.md', packageName: 'verbose-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'verbose-pkg@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({ entries, cwd: tmpDir, verbose: true });

    expect(result.deleted).toBe(1);
  }, 60_000);

  it('verbose dry-run logs phase messages', async () => {
    await installMockPackage('vdry-pkg', '1.0.0', { 'file.md': 'content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'file.md'), 'content');

    await writeMarker(markerPath(outputDir), [
      { path: 'file.md', packageName: 'vdry-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'vdry-pkg@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({
      entries,
      cwd: tmpDir,
      verbose: true,
      dryRun: true,
    });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'file.md'))).toBe(true);
  }, 60_000);

  it('hierarchically purges transitive packages declared in npmdata.sets', async () => {
    // Install child first
    await installMockPackage('pkg-child', '1.0.0', { 'child.md': 'child content' }, tmpDir);
    // Install parent (no files — only the npmdata.sets entry matters)
    await installMockPackage('pkg-parent', '1.0.0', { 'parent.md': 'parent content' }, tmpDir);
    // Patch parent's installed package.json to declare npmdata.sets → child
    const parentPkgJsonPath = path.join(tmpDir, 'node_modules', 'pkg-parent', 'package.json');
    const parentPkgJson = JSON.parse(fs.readFileSync(parentPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      parentPkgJsonPath,
      JSON.stringify({
        ...parentPkgJson,
        npmdata: { sets: [{ package: 'pkg-child@1.0.0', output: { path: 'child-out' } }] },
      }),
    );

    // Parent output dir
    const parentOutputDir = path.join(tmpDir, 'parent-out');
    fs.mkdirSync(parentOutputDir, { recursive: true });
    fs.writeFileSync(path.join(parentOutputDir, 'parent.md'), 'parent content');

    // Child output dir (inherits parent output path joined with child path)
    const childOutputDir = path.join(tmpDir, 'parent-out', 'child-out');
    fs.mkdirSync(childOutputDir, { recursive: true });
    fs.writeFileSync(path.join(childOutputDir, 'child.md'), 'child content');

    await writeMarker(markerPath(parentOutputDir), [
      { path: 'parent.md', packageName: 'pkg-parent', packageVersion: '1.0.0' },
    ]);
    await writeMarker(markerPath(childOutputDir), [
      { path: 'child.md', packageName: 'pkg-child', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'pkg-parent@1.0.0', output: { path: parentOutputDir } },
    ];
    const result = await actionPurge({ entries, cwd: tmpDir });

    // Both parent and child files should have been purged
    expect(result.deleted).toBe(2);
    expect(fs.existsSync(path.join(parentOutputDir, 'parent.md'))).toBe(false);
    expect(fs.existsSync(path.join(childOutputDir, 'child.md'))).toBe(false);
  }, 120_000);

  it('hierarchically purges transitive packages declared in npmdata.sets with verbose', async () => {
    // Install child first
    await installMockPackage('vp-child', '1.0.0', { 'child.md': 'child content' }, tmpDir);
    // Install parent, then patch npmdata.sets into the installed package.json
    await installMockPackage('vp-parent', '1.0.0', { 'parent.md': 'parent content' }, tmpDir);
    const parentPkgJsonPath = path.join(tmpDir, 'node_modules', 'vp-parent', 'package.json');
    const parentPkgJson = JSON.parse(fs.readFileSync(parentPkgJsonPath).toString());
    fs.writeFileSync(
      parentPkgJsonPath,
      JSON.stringify({
        ...parentPkgJson,
        npmdata: { sets: [{ package: 'vp-child@1.0.0', output: { path: 'child-out' } }] },
      }),
    );

    const parentOutputDir = path.join(tmpDir, 'vp-parent-out');
    fs.mkdirSync(parentOutputDir, { recursive: true });
    fs.writeFileSync(path.join(parentOutputDir, 'parent.md'), 'parent content');
    await writeMarker(markerPath(parentOutputDir), [
      { path: 'parent.md', packageName: 'vp-parent', packageVersion: '1.0.0' },
    ]);

    const childOutputDir = path.join(tmpDir, 'vp-parent-out', 'child-out');
    fs.mkdirSync(childOutputDir, { recursive: true });
    fs.writeFileSync(path.join(childOutputDir, 'child.md'), 'child content');
    await writeMarker(markerPath(childOutputDir), [
      { path: 'child.md', packageName: 'vp-child', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'vp-parent@1.0.0', output: { path: parentOutputDir } },
    ];
    const result = await actionPurge({ entries, cwd: tmpDir, verbose: true });

    expect(result.deleted).toBe(2);
    expect(fs.existsSync(path.join(parentOutputDir, 'parent.md'))).toBe(false);
    expect(fs.existsSync(path.join(childOutputDir, 'child.md'))).toBe(false);
  }, 120_000);

  it('leaves nested managed=false files on disk during purge', async () => {
    await installMockPackage(
      'purge-nested-child',
      '1.0.0',
      { 'conf/config-schema.js': 'pkg content' },
      tmpDir,
    );
    await installMockPackage(
      'purge-nested-parent',
      '1.0.0',
      { 'docs/guide.md': '# Guide' },
      tmpDir,
    );

    const parentPkgJsonPath = path.join(
      tmpDir,
      'node_modules',
      'purge-nested-parent',
      'package.json',
    );
    const parentPkgJson = JSON.parse(fs.readFileSync(parentPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      parentPkgJsonPath,
      JSON.stringify({
        ...parentPkgJson,
        npmdata: {
          sets: [
            {
              package: 'purge-nested-child@1.0.0',
              selector: { files: ['conf/config-schema.js'] },
              output: { path: '.', managed: false },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'out-nested-managed-false');
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(outputDir, 'conf'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs/guide.md'), '# Guide');
    fs.writeFileSync(path.join(outputDir, 'conf/config-schema.js'), 'custom local content');
    await writeMarker(markerPath(outputDir), [
      { path: 'docs/guide.md', packageName: 'purge-nested-parent', packageVersion: '1.0.0' },
    ]);

    const result = await actionPurge({
      entries: [{ package: 'purge-nested-parent@1.0.0', output: { path: outputDir } }],
      cwd: tmpDir,
    });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'conf/config-schema.js'))).toBe(true);
  }, 60000);
});
