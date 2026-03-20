import { mergeSelectorConfig, mergeOutputConfig } from './config-merge';

describe('mergeSelectorConfig', () => {
  it('preserves both file pattern groups when both have files', () => {
    const parent = { files: ['**/*.md', '**/*.ts', 'README.md'] };
    const child = { files: ['**/*.md', 'README.md', '**/*.json'] };
    const result = mergeSelectorConfig(parent, child);
    expect(result.files!.sort()).toEqual(['**/*.md', '**/*.ts', 'README.md', '**/*.json'].sort());
    expect(result.filePatternGroups).toEqual([
      ['**/*.md', '**/*.ts', 'README.md'],
      ['**/*.md', 'README.md', '**/*.json'],
    ]);
  });

  it('uses parent files when child has none', () => {
    const parent = { files: ['**/*.md'] };
    const child = {};
    const result = mergeSelectorConfig(parent, child);
    expect(result.files).toEqual(['**/*.md']);
  });

  it('uses child files when parent has none', () => {
    const parent = {};
    const child = { files: ['**/*.ts'] };
    const result = mergeSelectorConfig(parent, child);
    expect(result.files).toEqual(['**/*.ts']);
  });

  it('returns undefined files when both are absent', () => {
    const result = mergeSelectorConfig({}, {});
    expect(result.files).toBeUndefined();
  });

  it('concatenates contentRegexes from both configs', () => {
    const parent = { contentRegexes: ['foo'] };
    const child = { contentRegexes: ['bar'] };
    const result = mergeSelectorConfig(parent, child);
    expect(result.contentRegexes).toEqual(['foo', 'bar']);
  });

  it('concatenates exclude patterns from both configs', () => {
    const parent = { exclude: ['docs/private/**'] };
    const child = { exclude: ['docs/drafts/**'] };
    const result = mergeSelectorConfig(parent, child);
    expect(result.exclude).toEqual(['docs/private/**', 'docs/drafts/**']);
  });

  it('uses only parent contentRegexes when child has none', () => {
    const parent = { contentRegexes: ['x'] };
    const result = mergeSelectorConfig(parent, {});
    expect(result.contentRegexes).toEqual(['x']);
  });

  it('does NOT inherit presets from parent', () => {
    const parent = { presets: ['preset-a'] };
    const child = { presets: ['preset-b'] };
    const result = mergeSelectorConfig(parent, child);
    expect(result.presets).toEqual(['preset-b']);
  });

  it('uses child presets even if parent has presets and child has none', () => {
    const parent = { presets: ['preset-a'] };
    const child = {};
    const result = mergeSelectorConfig(parent, child);
    expect(result.presets).toBeUndefined();
  });

  it('uses child upgrade independently', () => {
    const parent = { upgrade: true };
    const child = { upgrade: false };
    const result = mergeSelectorConfig(parent, child);
    expect(result.upgrade).toBe(false);
  });
});

describe('mergeOutputConfig', () => {
  it('concatenates paths', () => {
    const caller = { path: 'output/docs' };
    const child = { path: 'guides' };
    const result = mergeOutputConfig(caller, child);
    expect(result.path).toBe('output/docs/guides');
  });

  it('normalises double slashes in paths', () => {
    const caller = { path: 'output' };
    const child = { path: 'guides' };
    const result = mergeOutputConfig(caller, child);
    expect(result.path).toBe('output/guides');
  });

  it('caller force overrides child', () => {
    const caller = { path: 'out', force: true };
    const child = { path: 'sub', force: false };
    const result = mergeOutputConfig(caller, child);
    expect(result.force).toBe(true);
  });

  it('uses child force when caller has none', () => {
    const caller = { path: 'out' };
    const child = { path: 'sub', force: true };
    const result = mergeOutputConfig(caller, child);
    expect(result.force).toBe(true);
  });

  it('caller keepExisting overrides child', () => {
    const caller = { path: 'out', keepExisting: true };
    const child = { path: 'sub', keepExisting: false };
    const result = mergeOutputConfig(caller, child);
    expect(result.keepExisting).toBe(true);
  });

  it('caller dryRun overrides child', () => {
    const caller = { path: 'out', dryRun: true };
    const child = { path: 'sub', dryRun: false };
    const result = mergeOutputConfig(caller, child);
    expect(result.dryRun).toBe(true);
  });

  it('appends symlinks from both configs', () => {
    const caller = { path: 'out', symlinks: [{ source: 'a', target: 'b' }] };
    const child = { path: 'sub', symlinks: [{ source: 'c', target: 'd' }] };
    const result = mergeOutputConfig(caller, child);
    expect(result.symlinks).toHaveLength(2);
    expect(result.symlinks![0]).toEqual({ source: 'a', target: 'b' });
    expect(result.symlinks![1]).toEqual({ source: 'c', target: 'd' });
  });

  it('appends contentReplacements from both configs', () => {
    const caller = {
      path: 'out',
      contentReplacements: [{ files: '*.md', match: 'foo', replace: 'bar' }],
    };
    const child = {
      path: 'sub',
      contentReplacements: [{ files: '*.ts', match: 'x', replace: 'y' }],
    };
    const result = mergeOutputConfig(caller, child);
    expect(result.contentReplacements).toHaveLength(2);
  });

  it('handles empty symlinks/contentReplacements gracefully', () => {
    const caller = { path: 'out' };
    const child = { path: 'sub' };
    const result = mergeOutputConfig(caller, child);
    expect(result.symlinks).toEqual([]);
    expect(result.contentReplacements).toEqual([]);
  });
});
