/* eslint-disable no-console */
import { NpmdataConfig, NpmdataExtractEntry } from '../../types';
import { parseArgv, buildEntriesFromArgv, applyArgvOverrides } from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionPurge } from '../../package/action-purge';

/**
 * `purge` CLI action handler.
 */
export async function runPurge(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('purge');
    return;
  }

  const parsed = parseArgv(argv);

  let entries: NpmdataExtractEntry[] = [];
  const cliEntries = buildEntriesFromArgv(parsed);
  if (cliEntries) {
    entries = cliEntries;
  } else if (config && config.sets.length > 0) {
    entries = applyArgvOverrides(config.sets, parsed);
  }

  const summary = await actionPurge({
    entries,
    cwd,
    dryRun: parsed.dryRun,
    verbose: parsed.verbose,
    onProgress: (event: import('../../types').ProgressEvent) => {
      if (parsed.silent) return;
      if (event.type === 'file-deleted') console.log(`  - ${formatProgressFile(event)}`);
    },
  });

  console.log(`Purge complete: ${summary.deleted} deleted.`);
}
