/* eslint-disable no-undefined */
/* eslint-disable unicorn/no-null */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { writeMarker, markerPath } from '../fileset/markers';
import { NpmdataExtractEntry } from '../types';

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
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# h');

    await writeMarker(markerPath(outputDir), [
      { path: 'README.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({ entries, config: null, cwd: tmpDir });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(false);
  });

  it('dry-run counts but does not delete', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# h');

    await writeMarker(markerPath(outputDir), [
      { path: 'README.md', packageName: 'mypkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    const result = await actionPurge({ entries, config: null, cwd: tmpDir, dryRun: true });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
  });

  it('only purges files for the matching package', async () => {
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
    const result = await actionPurge({ entries, config: null, cwd: tmpDir });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'a.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'b.md'))).toBe(true);
  });

  it('respects preset filtering', async () => {
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
      { package: 'pkg-a@1.0.0', output: { path: outA }, selector: { presets: ['preset-a'] } },
      { package: 'pkg-b@1.0.0', output: { path: outB }, selector: { presets: ['preset-b'] } },
    ];

    // Only process preset-a
    const result = await actionPurge({ entries, config: null, cwd: tmpDir, presets: ['preset-a'] });

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outA, 'a.md'))).toBe(false);
    expect(fs.existsSync(path.join(outB, 'b.md'))).toBe(true);
  });

  it('emits progress events', async () => {
    const events: string[] = [];
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const entries: NpmdataExtractEntry[] = [
      { package: 'mypkg@1.0.0', output: { path: outputDir } },
    ];
    await actionPurge({
      entries,
      config: null,
      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
    expect(events).toContain('package-end');
  });

  it('emits file-deleted events for each purged file', async () => {
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
      config: null,
      cwd: tmpDir,
      onProgress: (e) => events.push({ type: e.type, file: 'file' in e ? e.file : undefined }),
    });

    const fileDeleted = events.find((e) => e.type === 'file-deleted');
    expect(fileDeleted).toBeDefined();
  });

  it('hierarchically purges transitive packages declared in npmdata.sets', async () => {
    // Simulate a parent package (pkg-parent) installed in node_modules whose
    // package.json declares npmdata.sets pointing at a child package (pkg-child).
    const parentPkgDir = path.join(tmpDir, 'node_modules', 'pkg-parent');
    fs.mkdirSync(parentPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(parentPkgDir, 'package.json'),
      JSON.stringify({
        name: 'pkg-parent',
        version: '1.0.0',
        npmdata: {
          sets: [
            {
              package: 'pkg-child@1.0.0',
              output: { path: 'child-out' },
            },
          ],
        },
      }),
    );

    // Simulate the child package also installed (so hierarchical recursion can resolve further)
    const childPkgDir = path.join(tmpDir, 'node_modules', 'pkg-child');
    fs.mkdirSync(childPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(childPkgDir, 'package.json'),
      JSON.stringify({ name: 'pkg-child', version: '1.0.0' }),
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
    const result = await actionPurge({ entries, config: null, cwd: tmpDir });

    // Both parent and child files should have been purged
    expect(result.deleted).toBe(2);
    expect(fs.existsSync(path.join(parentOutputDir, 'parent.md'))).toBe(false);
    expect(fs.existsSync(path.join(childOutputDir, 'child.md'))).toBe(false);
  });
});
