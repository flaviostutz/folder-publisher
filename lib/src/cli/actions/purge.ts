/* eslint-disable no-console */
import { FiledistConfig, FiledistExtractEntry } from '../../types';
import { filterEntriesByPresets } from '../../utils';
import {
  parseArgv,
  buildEntriesFromArgv,
  applyArgvOverrides,
  resolveEffectivePresets,
  FiledistCliConfig,
} from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionPurge } from '../../package/action-purge';

/**
 * `purge` CLI action handler.
 */
export async function runPurge(
  config: FiledistConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('purge');
    return;
  }

  const parsed = parseArgv(argv);
  const effectivePresets = resolveEffectivePresets(parsed, config as FiledistCliConfig | null);

  let entries: FiledistExtractEntry[] = [];
  const cliEntries = buildEntriesFromArgv(parsed, effectivePresets);
  if (cliEntries) {
    entries = cliEntries;
  } else if (config && config.sets.length > 0) {
    entries = applyArgvOverrides(config.sets, parsed);
  }

  entries = filterEntriesByPresets(entries, effectivePresets);

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
