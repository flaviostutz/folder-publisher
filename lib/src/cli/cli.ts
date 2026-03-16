/* eslint-disable no-console */
import path from 'node:path';

import { searchAndLoadNpmdataConfig, loadNpmdataConfigFile } from '../package/config';
import { NpmdataConfig } from '../types';

import { printUsage, printVersion } from './usage';
import { runExtract } from './actions/extract';
import { runCheck } from './actions/check';
import { runList } from './actions/list';
import { runPurge } from './actions/purge';
import { runInit } from './actions/init';
import { runPresets } from './actions/presets';

const KNOWN_COMMANDS = new Set(['extract', 'check', 'list', 'purge', 'init', 'presets']);

/**
 * Top-level CLI router.
 * Detects command from argv, loads config, and dispatches to appropriate handler.
 *
 * @param argv      - Process argument vector (argv[0] = node, argv[1] = script).
 * @param cwd       - Working directory for output path resolution (defaults to process.cwd()).
 * @param configSearchCwd - Directory to search for npmdata config (defaults to cwd).
 */
export async function cli(argv: string[], cwd?: string, configSearchCwd?: string): Promise<number> {
  const args = argv.slice(2); // strip node + script

  // Handle global --help with no command
  if (args.includes('--help') && args.length === 1) {
    printUsage();
    return 0;
  }

  // Handle global --version
  if (args.includes('--version')) {
    printVersion();
    return 0;
  }

  // Detect action
  let action: string;
  let cmdArgs: string[];

  const firstArg = args[0];
  if (firstArg && KNOWN_COMMANDS.has(firstArg)) {
    action = firstArg;
    cmdArgs = args.slice(1);
  } else {
    // Default to extract
    action = 'extract';
    cmdArgs = args;
  }

  const effectiveCwd = cwd ?? process.cwd();
  const effectiveConfigSearchCwd = configSearchCwd ?? effectiveCwd;

  // Detect --config from full args (works regardless of position relative to command)
  const configFlagIdx = args.indexOf('--config');
  const configFilePath =
    configFlagIdx !== -1 && configFlagIdx + 1 < args.length
      ? args[configFlagIdx + 1]
      : // eslint-disable-next-line no-undefined
        undefined;

  // Load config from cwd, unless --packages is specified (CLI-only mode)
  const packagesSpecified = args.includes('--packages');

  let config: Awaited<ReturnType<typeof searchAndLoadNpmdataConfig>>;
  if (configFilePath) {
    config = await loadNpmdataConfigFile(path.resolve(effectiveCwd, configFilePath));
  } else if (packagesSpecified) {
    // eslint-disable-next-line unicorn/no-null
    config = null;
  } else {
    config = await searchAndLoadNpmdataConfig(effectiveConfigSearchCwd);
  }

  try {
    await dispatch(action, config, cmdArgs, effectiveCwd);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function dispatch(
  action: string,
  config: NpmdataConfig | null,
  cmdArgs: string[],
  cwd: string,
): Promise<void> {
  switch (action) {
    case 'extract':
      await runExtract(config, cmdArgs, cwd);
      break;
    case 'check':
      await runCheck(config, cmdArgs, cwd);
      break;
    case 'list':
      await runList(config, cmdArgs, cwd);
      break;
    case 'purge':
      await runPurge(config, cmdArgs, cwd);
      break;
    case 'init':
      await runInit(config, cmdArgs, cwd);
      break;
    case 'presets':
      await runPresets(config, cmdArgs);
      break;
    default:
      throw new Error(`Unknown command: ${action}`);
  }
}

export function setupUncaughtExceptionHandler(): void {
  if (!process.argv.includes('--verbose')) {
    process.on('uncaughtException', (err) => {
      const errs = `${err}`;
      let i = errs.indexOf('\n');
      if (i === -1) i = errs.length;
      console.log(errs.slice(0, Math.max(0, i)));
      process.exit(3);
    });
  }
}
