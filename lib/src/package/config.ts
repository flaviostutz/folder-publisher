import { cosmiconfig } from 'cosmiconfig';

import { NpmdataConfig } from '../types';

const CONFIG_BASENAMES = [
  '.npmdatarc',
  '.npmdatarc.json',
  '.npmdatarc.yaml',
  '.npmdatarc.yml',
  'npmdata.config.js',
  'npmdata.config.cjs',
  'package.json',
] as const;

/**
 * Search for an npmdata configuration using cosmiconfig, starting from the given cwd.
 * Looks for (in priority order):
 *   - .npmdatarc (JSON or YAML)
 *   - .npmdatarc.json / .npmdatarc.yaml / .npmdatarc.js
 *   - npmdata.config.js
 *   - "npmdata" key in package.json
 *
 * Returns the NpmdataConfig when found, or null when no configuration is present.
 */
export async function searchAndLoadNpmdataConfig(cwd: string): Promise<NpmdataConfig | null> {
  const explorer = cosmiconfig('npmdata');
  const result = await explorer.search(cwd);
  if (!result || result.isEmpty) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  const cfg = result.config as NpmdataConfig;
  if (!cfg || !Array.isArray(cfg.sets)) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  return cfg;
}

/**
 * Load an npmdata configuration from an explicit file path using cosmiconfig.
 * Supports JSON, YAML, and JS config files.
 *
 * Returns the NpmdataConfig when found, or null when the file is empty or invalid.
 */
export async function loadNpmdataConfigFile(filePath: string): Promise<NpmdataConfig | null> {
  const explorer = cosmiconfig('npmdata');
  const result = await explorer.load(filePath);
  if (!result || result.isEmpty) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  const cfg = result.config as NpmdataConfig;
  if (!cfg || !Array.isArray(cfg.sets)) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  return cfg;
}

/**
 * Load npmdata config only from the given directory, without searching parent folders.
 */
export async function loadNpmdataConfigFromDirectory(
  directory: string,
): Promise<NpmdataConfig | null> {
  const explorer = cosmiconfig('npmdata');

  for (const basename of CONFIG_BASENAMES) {
    let result;
    try {
      result = await explorer.load(`${directory}/${basename}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    if (!result || result.isEmpty) continue;

    const cfg = result.config as NpmdataConfig;
    if (cfg && Array.isArray(cfg.sets)) {
      return cfg;
    }
  }

  // eslint-disable-next-line unicorn/no-null
  return null;
}
