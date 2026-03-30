/* eslint-disable no-undefined */
import { FiledistConfig, FiledistExtractEntry, SelectorConfig, OutputConfig } from '../types';
import { filterEntriesByPresets } from '../utils';

export type FiledistCliConfig = FiledistConfig & {
  defaultPresets?: string[];
};

/**
 * Parsed CLI flags for all commands.
 * All flags are undefined when not supplied on the command line;
 * defaults are applied downstream in the library.
 */
export type ParsedArgv = {
  packages?: string[];
  output?: string;
  files?: string[];
  exclude?: string[];
  contentRegexes?: string[];
  presets?: string[];
  configFile?: string;
  force?: boolean;
  keepExisting?: boolean;
  /** --nosync / --nosync=true|false */
  nosync?: boolean;
  /** --gitignore / --gitignore=true|false */
  gitignore?: boolean;
  /** --managed / --managed=true|false  (false ≡ unmanaged mode) */
  managed?: boolean;
  dryRun?: boolean;
  upgrade?: boolean;
  silent?: boolean;
  verbose?: boolean;
};

export function resolveEffectivePresets(
  parsed: ParsedArgv,
  config?: FiledistCliConfig | null,
): string[] {
  return parsed.presets ?? config?.defaultPresets ?? [];
}

function buildSelectorFromArgv(parsed: ParsedArgv, presets: string[]): SelectorConfig {
  const selector: SelectorConfig = {};

  if (parsed.files) selector.files = parsed.files;
  if (parsed.exclude) selector.exclude = parsed.exclude;
  if (parsed.contentRegexes) selector.contentRegexes = parsed.contentRegexes;
  if (presets.length > 0) selector.presets = presets;
  if (parsed.upgrade !== undefined) selector.upgrade = parsed.upgrade;

  return selector;
}

function buildOutputFromArgv(parsed: ParsedArgv): OutputConfig {
  return {
    ...(parsed.output !== undefined ? { path: parsed.output } : {}),
    ...(parsed.force !== undefined ? { force: parsed.force } : {}),
    ...(parsed.keepExisting !== undefined ? { keepExisting: parsed.keepExisting } : {}),
    ...(parsed.nosync !== undefined ? { noSync: parsed.nosync } : {}),
    ...(parsed.gitignore !== undefined ? { gitignore: parsed.gitignore } : {}),
    ...(parsed.managed !== undefined ? { managed: parsed.managed } : {}),
    ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
  };
}

/**
 * Parse all supported CLI flags from an argv array.
 * Validates mutually exclusive combinations and throws on invalid input.
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const getBoolFlag = (flag: string): boolean | undefined => {
    for (const arg of argv) {
      if (arg === flag) return true;
      if (arg === `${flag}=true`) return true;
      if (arg === `${flag}=false`) return false;
    }

    return undefined;
  };
  const getValue = (flag: string, shortFlag?: string): string | undefined => {
    const idx = argv.findIndex((a) => a === flag || (shortFlag !== undefined && a === shortFlag));
    if (idx === -1 || idx + 1 >= argv.length) {
      return undefined;
    }
    return argv[idx + 1];
  };
  const getCommaSplit = (flag: string, shortFlag?: string): string[] | undefined => {
    const val = getValue(flag, shortFlag);

    if (val === undefined) {
      return undefined;
    }
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const force = getBoolFlag('--force');
  const keepExisting = getBoolFlag('--keep-existing');

  if (force === true && keepExisting === true) {
    throw new Error('--force and --keep-existing are mutually exclusive');
  }

  const packages = getCommaSplit('--packages');

  const verboseFlag = getBoolFlag('--verbose');

  return {
    packages,
    output: getValue('--output', '-o'),
    files: getCommaSplit('--files'),
    exclude: getCommaSplit('--exclude'),
    contentRegexes: getCommaSplit('--content-regex'),
    presets: getCommaSplit('--presets'),
    configFile: getValue('--config'),
    force,
    keepExisting,
    nosync: getBoolFlag('--nosync'),
    gitignore: getBoolFlag('--gitignore'),
    managed: getBoolFlag('--managed'),
    dryRun: getBoolFlag('--dry-run'),
    upgrade: getBoolFlag('--upgrade'),
    silent: getBoolFlag('--silent'),
    verbose: argv.includes('-v') ? true : verboseFlag,
  };
}

/**
 * Build FiledistExtractEntry objects from --packages + --output CLI flags.
 * Returns null if --packages is not set.
 */
export function buildEntriesFromArgv(
  parsed: ParsedArgv,
  presets: string[] = parsed.presets ?? [],
): FiledistExtractEntry[] | null {
  if (!parsed.packages || parsed.packages.length === 0) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }

  // In ad-hoc --packages mode there is no entry-level presets tag, so we place
  // --presets into selector.presets. filterEntriesByPresets checks both fields,
  // which keeps --presets filtering working in this mode.
  // selector.presets is also forwarded to the target package's nested set extraction.
  const selector = buildSelectorFromArgv(parsed, presets);
  const output = buildOutputFromArgv(parsed);

  return parsed.packages.map((pkg) => ({
    package: pkg,
    output,
    selector,
    ...(parsed.silent !== undefined ? { silent: parsed.silent } : {}),
    ...(parsed.verbose !== undefined ? { verbose: parsed.verbose } : {}),
  }));
}

/**
 * Apply CLI overrides from ParsedArgv to each FiledistExtractEntry.
 * CLI flags always take precedence over config file values.
 */
export function applyArgvOverrides(
  entries: FiledistExtractEntry[],
  parsed: ParsedArgv,
): FiledistExtractEntry[] {
  return entries.map((entry) => {
    const updatedOutput: OutputConfig = {
      ...entry.output,

      ...(parsed.output !== undefined ? { path: parsed.output } : {}),
      ...(parsed.force !== undefined ? { force: parsed.force } : {}),
      ...(parsed.keepExisting !== undefined ? { keepExisting: parsed.keepExisting } : {}),
      ...(parsed.nosync !== undefined ? { noSync: parsed.nosync } : {}),
      ...(parsed.gitignore !== undefined ? { gitignore: parsed.gitignore } : {}),
      ...(parsed.managed !== undefined ? { managed: parsed.managed } : {}),
      ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
    };

    const updatedSelector: SelectorConfig = {
      ...entry.selector,
      ...(parsed.files ? { files: parsed.files } : {}),
      ...(parsed.exclude ? { exclude: parsed.exclude } : {}),
      ...(parsed.contentRegexes ? { contentRegexes: parsed.contentRegexes } : {}),
      ...(parsed.upgrade !== undefined ? { upgrade: parsed.upgrade } : {}),
    };

    return {
      ...entry,
      output: updatedOutput,
      selector: updatedSelector,
      ...(parsed.silent !== undefined ? { silent: parsed.silent } : {}),
      ...(parsed.verbose !== undefined ? { verbose: parsed.verbose } : {}),
    };
  });
}

/**
 * Build and preset-filter extract entries from parsed CLI args and/or config.
 * When --packages is provided, entries come from the CLI flags.
 * Otherwise, entries come from the config sets with CLI overrides applied.
 * Results are filtered by any requested --presets.
 * Throws if no packages are configured.
 */
export function resolveEntriesFromConfigAndArgs(
  config: FiledistConfig | null,
  argv: string[],
): FiledistExtractEntry[] {
  const parsed = parseArgv(argv);
  const effectivePresets = resolveEffectivePresets(parsed, config as FiledistCliConfig | null);

  let entries = buildEntriesFromArgv(parsed, effectivePresets);
  if (!entries) {
    if (!config || config.sets.length === 0) {
      throw new Error(`No packages specified. Use --packages or a config file with sets.`);
    }
    entries = applyArgvOverrides(config.sets, parsed);
  }

  // filter by presets
  const filtered = filterEntriesByPresets(entries, effectivePresets);
  return filtered;
}
