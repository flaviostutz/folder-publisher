/* eslint-disable unicorn/no-null */

import { NpmdataConfig } from '../../types';
import { printUsage } from '../usage';

import { runPresets } from './presets';

jest.mock('../usage', () => ({ printUsage: jest.fn() }));

const mockPrintUsage = printUsage as jest.MockedFunction<typeof printUsage>;

const CONFIG: NpmdataConfig = {
  sets: [
    {
      package: 'pkg-a@1.0.0',
      presets: ['prod', 'staging'],
    },
    {
      package: 'pkg-b@2.0.0',
      presets: ['dev'],
      selector: { presets: ['staging'] },
    },
    {
      package: 'pkg-c@3.0.0',
      // no presets
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.exitCode;
});

afterEach(() => {
  delete process.exitCode;
});

describe('runPresets — --help', () => {
  it('prints usage and returns without iterating config', async () => {
    await runPresets(CONFIG, ['--help']);
    expect(mockPrintUsage).toHaveBeenCalledWith('presets');
  });
});

describe('runPresets — no config', () => {
  it('throws when config is null', async () => {
    await expect(runPresets(null, [])).rejects.toThrow('No configuration found');
  });

  it('throws when config has empty sets', async () => {
    await expect(runPresets({ sets: [] }, [])).rejects.toThrow('No configuration found');
  });
});

describe('runPresets — preset listing', () => {
  it('prints all unique presets sorted alphabetically', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await runPresets(CONFIG, []);
    spy.mockRestore();
    expect(lines).toEqual(['dev', 'prod', 'staging']);
  });

  it('deduplicates presets across multiple entries', async () => {
    const cfg: NpmdataConfig = {
      sets: [
        { package: 'a', presets: ['foo', 'bar'] },
        { package: 'b', presets: ['foo'] },
      ],
    };
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await runPresets(cfg, []);
    spy.mockRestore();
    expect(lines).toEqual(['bar', 'foo']);
  });

  it('does not list selector-level presets (those are internal CLI-args convention)', async () => {
    const cfg: NpmdataConfig = {
      sets: [{ package: 'a', selector: { presets: ['internal-only'] } }],
    };
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await runPresets(cfg, []);
    spy.mockRestore();
    expect(lines).toContain('No presets defined in configuration.');
  });

  it('prints message when no presets are defined', async () => {
    const cfg: NpmdataConfig = { sets: [{ package: 'a' }] };
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    await runPresets(cfg, []);
    spy.mockRestore();
    expect(lines).toContain('No presets defined in configuration.');
  });
});
