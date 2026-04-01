/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable unicorn/no-null */

import { actionExtract } from '../../package/action-extract';
import { FiledistConfig, ProgressEvent } from '../../types';
import { printUsage } from '../usage';

import { runExtract } from './extract';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawnSync: jest.fn().mockReturnValue({
    status: 0,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    // eslint-disable-next-line no-undefined
    error: undefined,
  }),
}));

// eslint-disable-next-line import/no-commonjs, @typescript-eslint/no-require-imports
const { spawnSync: mockSpawnSync } = require('node:child_process') as {
  spawnSync: jest.MockedFunction<typeof import('node:child_process').spawnSync>;
};

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;

jest.mock('../../package/action-extract', () => ({
  actionExtract: jest.fn(),
}));
const mockActionExtract = actionExtract as jest.MockedFunction<typeof actionExtract>;

const DEFAULT_RESULT = { added: 1, modified: 0, deleted: 0, skipped: 0 };

const CONFIG_WITH_SETS: FiledistConfig = {
  sets: [
    {
      package: 'config-pkg@1.0.0',
      output: { path: './config-out', force: false, gitignore: true },
      selector: {},
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
  mockActionExtract.mockResolvedValue(DEFAULT_RESULT);
  mockSpawnSync.mockReturnValue({
    pid: 0,
    output: [],
    // eslint-disable-next-line no-undefined
    error: undefined,
    status: 0,
    signal: null,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
  });
});

afterEach(() => {
  delete process.exitCode;
});

describe('runExtract — source selection', () => {
  it('uses CLI --packages entries when provided, ignoring config sets', async () => {
    await runExtract(
      CONFIG_WITH_SETS,
      ['--packages', 'cli-pkg@2.0.0', '--output', './cli-out', '--gitignore=false'],
      '/cwd',
    );
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('cli-pkg@2.0.0');
    expect(entries[0].output!.path).toBe('./cli-out');
  });

  it('uses config sets when --packages is not provided', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('config-pkg@1.0.0');
  });

  it('throws when no --packages and config is null', async () => {
    await expect(runExtract(null, [], '/cwd')).rejects.toThrow('No packages specified');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });

  it('throws when no --packages and config has empty sets', async () => {
    await expect(runExtract({ sets: [] }, [], '/cwd')).rejects.toThrow('No packages specified');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });

  it('passes multiple config sets when defined', async () => {
    const multiConfig: FiledistConfig = {
      sets: [
        { package: 'pkg-a@1.0.0', output: { path: './a' } },
        { package: 'pkg-b@2.0.0', output: { path: './b' } },
      ],
    };
    await runExtract(multiConfig, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries[0].package).toBe('pkg-a@1.0.0');
    expect(entries[1].package).toBe('pkg-b@2.0.0');
  });
});

describe('runExtract — CLI overrides applied to config entries', () => {
  it('overrides output path with --output', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--output', './override-out'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.path).toBe('./override-out');
  });

  it('overrides force with --force', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--force'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.force).toBe(true);
  });

  it('overrides dryRun with --dry-run', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--dry-run'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.dryRun).toBe(true);
  });

  it('overrides gitignore with --gitignore=false', async () => {
    // Config entry has gitignore: true — CLI flag should override to false
    await runExtract(CONFIG_WITH_SETS, ['--gitignore=false'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.gitignore).toBe(false);
  });

  it('overrides keepExisting with --keep-existing', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--keep-existing'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.keepExisting).toBe(true);
  });

  it('overrides noSync with --nosync', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--nosync'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.noSync).toBe(true);
  });

  it('overrides silent with --silent', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--silent'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].silent).toBe(true);
  });

  it('preserves config entry values when no overriding CLI flag given', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.path).toBe('./config-out');
    expect(entries[0].output!.force).toBe(false);
    expect(entries[0].output!.gitignore).toBe(true);
  });

  it('applies CLI overrides to all config entries', async () => {
    const multiConfig: FiledistConfig = {
      sets: [
        { package: 'pkg-a@1.0.0', output: { path: './a' } },
        { package: 'pkg-b@2.0.0', output: { path: './b' } },
      ],
    };
    await runExtract(multiConfig, ['--dry-run', '--silent'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.dryRun).toBe(true);
    expect(entries[0].silent).toBe(true);
    expect(entries[1].output!.dryRun).toBe(true);
    expect(entries[1].silent).toBe(true);
  });
});

describe('runExtract — CLI --packages does not apply applyArgvOverrides redundantly', () => {
  it('embeds CLI flags directly in entries built from --packages', async () => {
    // When --packages is used, flags are already baked in by buildEntriesFromArgv
    await runExtract(
      null,
      ['--packages', 'cli-pkg', '--force', '--dry-run', '--silent', '--gitignore=false'],
      '/cwd',
    );
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries[0].output!.force).toBe(true);
    expect(entries[0].output!.dryRun).toBe(true);
    expect(entries[0].output!.gitignore).toBe(false);
    expect(entries[0].silent).toBe(true);
  });
});

describe('runExtract — preset filtering', () => {
  const configWithPresets: FiledistConfig = {
    sets: [
      { package: 'pkg-docs@1.0.0', output: { path: '.' }, selector: { presets: ['docs'] } },
      { package: 'pkg-api@1.0.0', output: { path: '.' }, selector: { presets: ['api'] } },
    ],
  };

  it('passes all config entries when no presets specified', async () => {
    await runExtract(configWithPresets, [], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(2);
  });

  it('filters config entries to matching preset', async () => {
    await runExtract(configWithPresets, ['--presets', 'docs'], '/cwd');
    const { entries } = mockActionExtract.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].package).toBe('pkg-docs@1.0.0');
  });

  it('does not call actionExtract when no entries match preset', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runExtract(configWithPresets, ['--presets', 'nonexistent'], '/cwd');
    spy.mockRestore();
    expect(mockActionExtract).not.toHaveBeenCalled();
  });
});

describe('runExtract — error handling', () => {
  it('throws on invalid argv and skips actionExtract', async () => {
    await expect(
      runExtract(CONFIG_WITH_SETS, ['--force', '--keep-existing'], '/cwd'),
    ).rejects.toThrow('--force and --keep-existing are mutually exclusive');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });

  it('propagates error when actionExtract throws', async () => {
    mockActionExtract.mockRejectedValue(new Error('extract failed'));
    await expect(runExtract(CONFIG_WITH_SETS, [], '/cwd')).rejects.toThrow('extract failed');
  });
});

describe('runExtract — --help', () => {
  it('prints usage and returns without calling actionExtract', async () => {
    await runExtract(CONFIG_WITH_SETS, ['--help'], '/cwd');
    expect(mockPrintUsage).toHaveBeenCalledWith('extract');
    expect(mockActionExtract).not.toHaveBeenCalled();
  });
});

describe('runExtract — summary output', () => {
  it('prints correct summary line after successful extract', async () => {
    mockActionExtract.mockResolvedValue({ added: 3, modified: 1, deleted: 2, skipped: 4 });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    expect(spy).toHaveBeenCalledWith(
      'Extract complete: 3 added, 1 modified, 2 deleted, 4 skipped.',
    );
    spy.mockRestore();
  });

  it('passes cwd and config through to actionExtract', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/my/cwd');
    const callArg = mockActionExtract.mock.calls[0][0];
    expect(callArg.cwd).toBe('/my/cwd');
  });
});

describe('runExtract — onProgress handler', () => {
  // Helper: capture onProgress, call it with a fake event, check console output
  const runWithEvent = async (event: ProgressEvent, silent = false): Promise<string[]> => {
    let capturedOnProgress: ((e: ProgressEvent) => void) | undefined;
    mockActionExtract.mockImplementation(async ({ onProgress }) => {
      capturedOnProgress = onProgress;
      return DEFAULT_RESULT;
    });

    const config: FiledistConfig = {
      sets: [{ package: 'pkg@1.0.0', output: { path: '.' }, silent }],
    };
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await runExtract(config, [], '/cwd');
    capturedOnProgress!(event);
    spy.mockRestore();
    return logs;
  };

  it('logs file-added event with + prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/a.md',
      managed: true,
      gitignore: true,
    });
    expect(logs.includes('  + docs/a.md (M,I)')).toBe(true);
  });

  it('logs file-modified event with ~ prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-modified',
      packageName: 'pkg',
      file: 'docs/b.md',
      managed: false,
      gitignore: true,
    });
    expect(logs.includes('  ~ docs/b.md (U,I)')).toBe(true);
  });

  it('logs file-deleted event with - prefix', async () => {
    const logs = await runWithEvent({
      type: 'file-deleted',
      packageName: 'pkg',
      file: 'docs/c.md',
      managed: true,
      gitignore: false,
    });
    expect(logs.includes('  - docs/c.md (M,G)')).toBe(true);
  });

  it('suppresses progress output when entry is silent', async () => {
    const logs = await runWithEvent(
      { type: 'file-added', packageName: 'pkg', file: 'x.md', managed: true, gitignore: true },
      true,
    );
    // Only the summary line should appear, not a progress line
    expect(logs.every((l) => !l.startsWith('  +'))).toBe(true);
  });

  it('ignores file-skipped events (no log)', async () => {
    const logs = await runWithEvent({
      type: 'file-skipped',
      packageName: 'pkg',
      file: 'docs/d.md',
      managed: true,
      gitignore: true,
    });
    expect(logs.every((l) => !l.includes('docs/d.md'))).toBe(true);
  });

  it('renders managed and tracked suffix when gitignore is false', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/e.md',
      managed: true,
      gitignore: false,
    });
    expect(logs.includes('  + docs/e.md (M,G)')).toBe(true);
    expect(logs.every((l) => !l.includes('docs/e.md (M,I)'))).toBe(true);
  });

  it('renders unmanaged and gitignored suffix when only gitignore is true', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/f.md',
      managed: false,
      gitignore: true,
    });
    expect(logs.includes('  + docs/f.md (U,I)')).toBe(true);
  });

  it('renders unmanaged and tracked suffix when neither flag is true', async () => {
    const logs = await runWithEvent({
      type: 'file-added',
      packageName: 'pkg',
      file: 'docs/g.md',
      managed: false,
      gitignore: false,
    });
    expect(logs.includes('  + docs/g.md (U,G)')).toBe(true);
  });
});

describe('runExtract — postExtractCmd', () => {
  const configWithArrayCmd: FiledistConfig = {
    sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
    postExtractCmd: ['node', 'scripts/post-extract.js'],
  };

  it('runs array postExtractCmd without shell', async () => {
    await runExtract(configWithArrayCmd, ['--silent'], '/cwd');
    expect(mockSpawnSync).toHaveBeenCalledWith('node', ['scripts/post-extract.js', '--silent'], {
      cwd: '/cwd',
      stdio: 'pipe',
      encoding: 'utf8',
    });
  });

  it('throws when postExtractCmd is a string instead of an argv array', async () => {
    await expect(
      runExtract(
        {
          sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
          postExtractCmd: 'node scripts/post-extract.js' as unknown as string[],
        },
        [],
        '/cwd',
      ),
    ).rejects.toThrow(
      '"postExtractCmd" must be an array of strings, for example ["node", "scripts/post-extract.js"]. ' +
        'Shell strings like "node scripts/post-extract.js" are not supported.',
    );
  });

  it('throws when postExtractCmd array is empty', async () => {
    await expect(
      runExtract(
        {
          sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
          postExtractCmd: [],
        },
        [],
        '/cwd',
      ),
    ).rejects.toThrow('"postExtractCmd" must include the executable as the first array item');
  });

  it('throws when legacy postExtractScript is still present', async () => {
    await expect(
      runExtract(
        {
          sets: [{ package: 'pkg@1.0.0', output: { path: '.' } }],
          postExtractScript: ['node', 'scripts/post-extract.js'],
        } as FiledistConfig & { postExtractScript: string[] },
        [],
        '/cwd',
      ),
    ).rejects.toThrow(
      '"postExtractScript" was renamed to "postExtractCmd". Use "postExtractCmd": ["node", "scripts/post-extract.js"].',
    );
  });

  it('does not run postExtractCmd when --dry-run', async () => {
    await runExtract(configWithArrayCmd, ['--dry-run'], '/cwd');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('does not run postExtractCmd when config has no command', async () => {
    await runExtract(CONFIG_WITH_SETS, [], '/cwd');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('throws the OS error when spawnSync returns an error object', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: null,
      error: new Error('spawn ENOENT'),
    });
    await expect(runExtract(configWithArrayCmd, [], '/cwd')).rejects.toThrow('spawn ENOENT');
  });

  it('does not throw when spawnSync exits with non-zero status but no OS error', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: 0,
      signal: null,
      // eslint-disable-next-line no-undefined
      error: undefined,
    });
    await expect(runExtract(configWithArrayCmd, [], '/cwd')).resolves.toBeUndefined();
  });

  it('does not print summary after script failure', async () => {
    mockSpawnSync.mockReturnValue({
      pid: 0,
      output: [],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: null,
      signal: null,
      error: new Error('fail'),
    });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runExtract(configWithArrayCmd, [], '/cwd')).rejects.toThrow();
    spy.mockRestore();
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Extract complete'));
  });
});
