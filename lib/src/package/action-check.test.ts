/* eslint-disable unicorn/no-null */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { installMockPackage } from '../fileset/test-utils';
import { NpmdataExtractEntry } from '../types';
import { writeMarker, markerPath } from '../fileset/markers';

import { actionCheck } from './action-check';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-action-check-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionCheck', () => {
  it('returns empty summary when entries array is empty', async () => {
    const result = await actionCheck({ entries: [], config: null, cwd: tmpDir });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('returns empty summary when files match source', async () => {
    await installMockPackage('check-action-pkg', '1.0.0', { 'README.md': '# OK' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# OK');

    const markerFile = markerPath(outputDir);
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    await writeMarker(markerFile, [
      { path: 'README.md', packageName: 'check-action-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'check-action-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, config: null, cwd: tmpDir });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('reports missing when package not installed', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write a marker for a file
    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'src/index.ts', packageName: 'nonexistent-pkg', packageVersion: '1.0.0' },
    ]);
    fs.mkdirSync(path.join(outputDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'src/index.ts'), 'x');

    const entries: NpmdataExtractEntry[] = [
      { package: 'nonexistent-pkg', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, config: null, cwd: tmpDir });
    // nonexistent-pkg is not installed → all marker entries go to missing
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('skips unmanaged entries when skipUnmanaged=true', async () => {
    const entries: NpmdataExtractEntry[] = [
      { package: 'some-pkg', output: { path: path.join(tmpDir, 'out'), unmanaged: true } },
    ];

    const result = await actionCheck({ entries, config: null, cwd: tmpDir, skipUnmanaged: true });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('aggregates results from multiple entries', async () => {
    await installMockPackage('multi-pkg', '1.0.0', { 'a.md': 'aaa' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    // Don't extract the file → it will be "modified" (hash mismatch) or "missing"

    // Write a marker entry with wrong hash (will cause modified detection)
    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'a.md', packageName: 'multi-pkg', packageVersion: '1.0.0' },
    ]);
    // Write the file with different content
    fs.writeFileSync(path.join(outputDir, 'a.md'), 'different content');

    const entries: NpmdataExtractEntry[] = [
      { package: 'multi-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, config: null, cwd: tmpDir });
    // Since hash differs, should be in modified
    expect(result.modified).toContain('a.md');
  }, 60000);

  it('emits onProgress events', async () => {
    const events: string[] = [];
    const entries: NpmdataExtractEntry[] = [
      { package: 'nonexistent-pkg@1.0.0', output: { path: path.join(tmpDir, 'out') } },
    ];

    await actionCheck({
      entries,
      config: null,
      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
  });

  it('uses "latest" when package spec has no version', async () => {
    await installMockPackage('no-version-pkg', '2.0.0', { 'a.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-nv');
    fs.mkdirSync(outputDir, { recursive: true });

    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'a.txt', packageName: 'no-version-pkg', packageVersion: '2.0.0' },
    ]);
    fs.writeFileSync(path.join(outputDir, 'a.txt'), 'hello');

    const events: Array<{ type: string; version?: string }> = [];
    const entries: NpmdataExtractEntry[] = [
      // No version specified → should use 'latest' in progress events
      { package: 'no-version-pkg', output: { path: outputDir } },
    ];

    await actionCheck({
      entries,
      config: null,
      cwd: tmpDir,
      onProgress: (e) => {
        if ('packageVersion' in e) {
          events.push({ type: e.type, version: e.packageVersion });
        }
      },
    });

    // Should emit package-end with 'latest' since no version was in spec
    const endEvent = events.find((e) => e.type === 'package-end');
    expect(endEvent).toBeDefined();
    expect(endEvent?.version).toBe('latest');
  }, 60000);

  it('uses provided selector when checking', async () => {
    await installMockPackage('sel-pkg', '1.0.0', { 'docs/api.md': '# API' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-sel');
    fs.mkdirSync(outputDir, { recursive: true });

    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'docs/api.md', packageName: 'sel-pkg', packageVersion: '1.0.0' },
    ]);
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs/api.md'), '# API');

    const entries: NpmdataExtractEntry[] = [
      {
        package: 'sel-pkg@1.0.0',
        selector: { files: ['**'] },
        output: { path: outputDir },
      },
    ];

    const result = await actionCheck({ entries, config: null, cwd: tmpDir });
    // With selector matching all files, should be clean
    expect(result.modified).toHaveLength(0);
  }, 60000);

  it('presets option filters which entries are checked', async () => {
    await installMockPackage('presets-docs-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('presets-data-pkg', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    const docsOutput = path.join(tmpDir, 'out-docs');
    const dataOutput = path.join(tmpDir, 'out-data');

    // Set up marker and matching files for both packages so check passes when run
    fs.mkdirSync(path.join(docsOutput, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(docsOutput, 'docs/guide.md'), '# Guide');
    await writeMarker(markerPath(docsOutput), [
      { path: 'docs/guide.md', packageName: 'presets-docs-pkg', packageVersion: '1.0.0' },
    ]);

    fs.mkdirSync(path.join(dataOutput, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dataOutput, 'data/sample.csv'), 'a,b');
    await writeMarker(markerPath(dataOutput), [
      { path: 'data/sample.csv', packageName: 'presets-data-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'presets-docs-pkg@1.0.0', output: { path: docsOutput }, presets: ['docs'] },
      { package: 'presets-data-pkg@1.0.0', output: { path: dataOutput }, presets: ['data'] },
    ];

    // Check with presets=['docs'] — only the docs entry is checked
    const resultDocs = await actionCheck({ entries, config: null, cwd: tmpDir, presets: ['docs'] });
    expect(resultDocs.missing).toHaveLength(0);
    expect(resultDocs.modified).toHaveLength(0);
    expect(resultDocs.extra).toHaveLength(0);

    // Delete the data file — with presets=['docs'] it is ignored
    fs.rmSync(path.join(dataOutput, 'data/sample.csv'));
    const resultDocsOnly = await actionCheck({
      entries,
      config: null,
      cwd: tmpDir,
      presets: ['docs'],
    });
    // data entry was filtered out, so missing data file is not reported
    expect(resultDocsOnly.missing).toHaveLength(0);

    // Now check with presets=['data'] — the missing data file should be reported
    const resultData = await actionCheck({
      entries,
      config: null,
      cwd: tmpDir,
      presets: ['data'],
    });
    expect(resultData.missing).toContain('data/sample.csv');
  }, 60000);

  it('presets=[] checks all entries', async () => {
    await installMockPackage('all-presets-pkg', '1.0.0', { 'file.md': '# File' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out-all');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'file.md'), '# File');
    await writeMarker(markerPath(outputDir), [
      { path: 'file.md', packageName: 'all-presets-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'all-presets-pkg@1.0.0', output: { path: outputDir }, presets: ['some-tag'] },
    ];

    // presets=[] means no filtering — all entries pass through
    const result = await actionCheck({ entries, config: null, cwd: tmpDir, presets: [] });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  }, 60000);
});
