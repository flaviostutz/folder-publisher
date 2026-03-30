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

  it('prints general usage when no command is given', () => {
    printUsage();
    expect(lines.join('\n')).toMatch(/usage: filedist \[command] \[options]/i);
    expect(lines.join('\n')).toMatch(/extract \(default\)/i);
    expect(lines.join('\n')).toMatch(/check/i);
    expect(lines.join('\n')).not.toMatch(/--packages/);
  });

  it('prints extract usage when command is "extract"', () => {
    printUsage('extract');
    expect(lines.join('\n')).toMatch(/filedist.*extract/i);
    expect(lines.join('\n')).toMatch(/--output/);
    expect(lines.join('\n')).toMatch(/--nosync/);
    expect(lines.join('\n')).toMatch(/git:github\.com/);
    expect(lines.join('\n')).toMatch(/defaultpresets/i);
    expect(lines.join('\n')).not.toMatch(/--source/);
  });

  it('prints check usage when command is "check"', () => {
    printUsage('check');
    expect(lines.join('\n')).toMatch(/filedist check/i);
    expect(lines.join('\n')).toMatch(/drift detected/i);
  });

  it('prints list usage when command is "list"', () => {
    printUsage('list');
    expect(lines.join('\n')).toMatch(/filedist list/i);
    expect(lines.join('\n')).toMatch(/currently managed/i);
  });

  it('prints purge usage when command is "purge"', () => {
    printUsage('purge');
    expect(lines.join('\n')).toMatch(/filedist purge/i);
    expect(lines.join('\n')).toMatch(/remove/i);
  });

  it('prints init usage when command is "init"', () => {
    printUsage('init');
    expect(lines.join('\n')).toMatch(/filedist init/i);
    expect(lines.join('\n')).toMatch(/package\.json/i);
  });

  it('prints general usage for an unknown command', () => {
    printUsage('unknown');
    expect(lines.join('\n')).toMatch(/filedist.*command/i);
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
