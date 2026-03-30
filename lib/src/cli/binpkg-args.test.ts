import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('./cli', () => ({
  cli: jest.fn().mockResolvedValue(0),
  setupUncaughtExceptionHandler: jest.fn(),
}));

import { cli } from './cli';
import { binpkg } from './binpkg';

const mockCli = cli as jest.MockedFunction<typeof cli>;

describe('binpkg defaultPresets forwarding', () => {
  let tmpDir: string;
  let binDir: string;
  let exitSpy: jest.SpyInstance;
  let originalCwd: string;

  beforeEach(() => {
    jest.clearAllMocks();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'binpkg-args-test-'));
    binDir = path.join(tmpDir, 'pkg', 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    originalCwd = process.cwd();
    process.chdir(tmpDir);

    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 'undefined'})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('injects defaultPresets when the user does not pass --presets', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'package.json'),
      JSON.stringify({
        name: 'example-files-package',
        version: '1.0.0',
        filedist: { defaultPresets: ['basic', 'eslint'] },
      }),
    );

    await expect(binpkg(binDir, ['extract', '--output', 'output'])).rejects.toThrow(
      'process.exit(0)',
    );

    expect(mockCli).toHaveBeenCalledWith(
      [
        'node',
        'filedist',
        'extract',
        '--output',
        'output',
        '--presets',
        'basic,eslint',
        '--packages',
        'example-files-package',
      ],
      process.cwd(),
    );
  });

  it('does not inject defaultPresets when the user already passed --presets', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pkg', 'package.json'),
      JSON.stringify({
        name: 'example-files-package',
        version: '1.0.0',
        filedist: { defaultPresets: ['basic'] },
      }),
    );

    await expect(
      binpkg(binDir, ['extract', '--output', 'output', '--presets', 'special']),
    ).rejects.toThrow('process.exit(0)');

    expect(mockCli).toHaveBeenCalledWith(
      [
        'node',
        'filedist',
        'extract',
        '--output',
        'output',
        '--presets',
        'special',
        '--packages',
        'example-files-package',
      ],
      process.cwd(),
    );
  });
});
