/* eslint-disable no-console */

import { FiledistConfig, ProgressEvent } from '../../types';
import { parseArgv, resolveEntriesFromConfigAndArgs } from '../argv';
import { printUsage } from '../usage';
import { formatProgressFile } from '../progress';
import { actionExtract } from '../../package/action-extract';
import { spawnWithLog } from '../../utils';

const POST_EXTRACT_CMD_EXAMPLE = '["node", "scripts/post-extract.js"]';

function resolvePostExtractCmd(
  postExtractCmd: unknown,
  argv: string[],
): { command: string; args: string[]; display: string } {
  if (!Array.isArray(postExtractCmd) || postExtractCmd.some((part) => typeof part !== 'string')) {
    throw new Error(
      `"postExtractCmd" must be an array of strings, for example ${POST_EXTRACT_CMD_EXAMPLE}. ` +
        `Shell strings like "node scripts/post-extract.js" are not supported.`,
    );
  }

  const [command, ...baseArgs] = postExtractCmd;
  if (!command) {
    throw new Error('"postExtractCmd" must include the executable as the first array item');
  }
  const args = [...baseArgs, ...argv];
  const display = [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
  return { command, args, display };
}

/**
 * `extract` CLI action handler.
 * Parses argv, merges with config, calls actionExtract, prints summary.
 */
export async function runExtract(
  config: FiledistConfig | null,
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

  const legacyPostExtractScript = (
    config as (FiledistConfig & { postExtractScript?: unknown }) | null
  )?.postExtractScript;
  // eslint-disable-next-line no-undefined
  if (legacyPostExtractScript !== undefined) {
    throw new Error(
      `"postExtractScript" was renamed to "postExtractCmd". Use "postExtractCmd": ${POST_EXTRACT_CMD_EXAMPLE}.`,
    );
  }

  // Run postExtractCmd if configured and not dry-run
  const isDryRun = entries.some((e) => e.output?.dryRun);
  // eslint-disable-next-line no-undefined
  if (!isDryRun && config?.postExtractCmd !== undefined) {
    const command = resolvePostExtractCmd(config.postExtractCmd, argv);
    if (parsed.verbose) {
      console.log(`[verbose] Running post-extract command: ${command.display}`);
    }
    spawnWithLog(command.command, command.args, cwd, parsed.verbose, true);
    if (parsed.verbose) {
      console.log(`[verbose] Post-extract command completed successfully.`);
    }
  }

  console.log(
    `Extract complete: ${result.added} added, ${result.modified} modified, ` +
      `${result.deleted} deleted, ${result.skipped} skipped.`,
  );
}
