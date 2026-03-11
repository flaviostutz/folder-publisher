/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { printUsage } from '../usage';

/**
 * `presets` CLI action handler.
 * Lists all unique preset tags found across config entries.
 */
export async function runPresets(config: NpmdataConfig | null, argv: string[]): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('presets');
    return;
  }

  if (!config || config.sets.length === 0) {
    throw new Error('No configuration found. Use a config file with sets to list presets.');
  }

  const seen = new Set<string>();
  for (const entry of config.sets) {
    for (const preset of entry.presets ?? []) seen.add(preset);
  }

  if (seen.size === 0) {
    console.log('No presets defined in configuration.');
    return;
  }

  for (const preset of [...seen].sort()) {
    console.log(preset);
  }
}
