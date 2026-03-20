/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv, resolveEntriesFromConfigAndArgs } from '../argv';
import { printUsage } from '../usage';
import { actionCheck } from '../../package/action-check';

/**
 * `check` CLI action handler.
 */
export async function runCheck(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('check');
    return;
  }

  const parsed = parseArgv(argv);
  const entries = resolveEntriesFromConfigAndArgs(config, argv);

  const summary = await actionCheck({
    entries,
    cwd,
    verbose: parsed.verbose,
  });

  const hasDrift =
    summary.missing.length > 0 || summary.conflict.length > 0 || summary.extra.length > 0;

  if (hasDrift) {
    for (const f of summary.missing) console.log(`missing: ${f}`);
    for (const f of summary.conflict) console.log(`conflict: ${f}`);
    for (const f of summary.extra) console.log(`extra: ${f}`);
    throw new Error('Check failed: some managed files are out of sync');
  } else {
    console.log('All managed files are in sync');
  }
}
