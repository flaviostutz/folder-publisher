/* eslint-disable no-console */

import { NpmdataConfig, ProgressEvent } from '../../types';
import { parseArgv, resolveEntriesFromConfigAndArgs } from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionExtract } from '../../package/action-extract';
import { spawnWithLog } from '../../utils';

/**
 * `extract` CLI action handler.
 * Parses argv, merges with config, calls actionExtract, prints summary.
 */
export async function runExtract(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('extract');
    return;
  }
  const parsed = parseArgv(argv);
  const entries = resolveEntriesFromConfigAndArgs(config, argv);

  if (entries.length === 0) {
    if (parsed.verbose) {
      console.log('[verbose] No packages match the specified preset filter. Nothing to extract.');
    }
    return;
  }

  if (parsed.verbose) {
    console.log(
      `[verbose] Running CLI extract with entries: ${entries.map((e) => e.package + ' ' + JSON.stringify(e.selector)).join(', ')}`,
    );
  }

  const result = await actionExtract({
    entries,
    cwd,
    verbose: parsed.verbose,
    onProgress: (event: ProgressEvent) => {
      if (entries[0]?.silent) return;
      if (event.type === 'file-added') console.log(`  + ${formatProgressFile(event)}`);
      else if (event.type === 'file-modified') console.log(`  ~ ${formatProgressFile(event)}`);
      else if (event.type === 'file-deleted') console.log(`  - ${formatProgressFile(event)}`);
    },
  });

  // Run postExtractScript if configured and not dry-run
  const isDryRun = entries.some((e) => e.output?.dryRun);
  if (!isDryRun && config?.postExtractScript) {
    const scriptCmd = `${config.postExtractScript} ${argv.join(' ')}`.trim();
    if (parsed.verbose) {
      console.log(`[verbose] Running post-extract script: ${scriptCmd}`);
    }
    spawnWithLog(scriptCmd, [], cwd, parsed.verbose, true);
    if (parsed.verbose) {
      console.log(`[verbose] Post-extract script completed successfully.`);
    }
  }

  console.log(
    `Extract complete: ${result.added} added, ${result.modified} modified, ` +
      `${result.deleted} deleted, ${result.skipped} skipped.`,
  );
}
