import { printUsage, printVersion } from './usage';

describe('printUsage', () => {
  let lines: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    lines = [];
    spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('prints extract usage when no command is given (default)', () => {
    printUsage();
    expect(lines.join('\n')).toMatch(/npmdata.*extract/i);
    expect(lines.join('\n')).toMatch(/--packages/);
  });

  it('prints extract usage when command is "extract"', () => {
    printUsage('extract');
    expect(lines.join('\n')).toMatch(/npmdata.*extract/i);
    expect(lines.join('\n')).toMatch(/--output/);
    expect(lines.join('\n')).toMatch(/--nosync/);
    expect(lines.join('\n')).toMatch(/--source/);
  });

  it('prints check usage when command is "check"', () => {
    printUsage('check');
    expect(lines.join('\n')).toMatch(/npmdata check/i);
    expect(lines.join('\n')).toMatch(/drift detected/i);
  });

  it('prints list usage when command is "list"', () => {
    printUsage('list');
    expect(lines.join('\n')).toMatch(/npmdata list/i);
    expect(lines.join('\n')).toMatch(/currently managed/i);
  });

  it('prints purge usage when command is "purge"', () => {
    printUsage('purge');
    expect(lines.join('\n')).toMatch(/npmdata purge/i);
    expect(lines.join('\n')).toMatch(/remove/i);
  });

  it('prints init usage when command is "init"', () => {
    printUsage('init');
    expect(lines.join('\n')).toMatch(/npmdata init/i);
    expect(lines.join('\n')).toMatch(/package\.json/i);
  });

  it('prints general usage for an unknown command', () => {
    printUsage('unknown');
    expect(lines.join('\n')).toMatch(/npmdata.*command/i);
    expect(lines.join('\n')).toMatch(/extract.*default/i);
  });
});

describe('printVersion', () => {
  it('prints a version string matching semver', () => {
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.join(' '));
    });
    printVersion();
    spy.mockRestore();
    expect(lines.join('\n')).toMatch(/\d+\.\d+/);
  });
});
