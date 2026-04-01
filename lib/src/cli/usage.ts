/* eslint-disable no-console */

const VERSION = '2.0.0';

/**
 * Print usage/help text for the given command to stdout.
 * When no command is provided, print the top-level command index.
 */
export function printUsage(command?: string): void {
  const cmd = command;

  switch (cmd) {
    case 'extract':
      console.log(`
Usage: filedist [extract] [options]

Extract files from one or more npm packages into a local output directory.
In config-file mode, the root-level postExtractCmd runs after a successful non-dry-run extract.

Options:
  --packages <specs>      Comma-separated package specs (e.g. my-pkg@^1.2.3, git:github.com/org/repo.git@main). Overrides config sets.
  --output, -o <dir>      Output directory path. Required when --packages is used.
  --files <globs>         Comma-separated glob patterns for file selection.
  --content-regex <re>    Comma-separated regex strings for content filtering.
  --force                 Overwrite existing unmanaged files.
  --keep-existing         Skip files that already exist; create missing ones.
  --nosync [bool]         Keep stale managed files on disk during extract (default: false).
  --gitignore [bool]      Enable/disable .gitignore update (default: true). Use --gitignore=false to disable.
  --managed [bool]        Enable/disable managed mode (default: true). Use --managed=false to write without .filedist marker.
  --dry-run               Report changes without writing to disk.
  --upgrade               Force fresh package install even if satisfying version installed.
  --presets <tags>        Comma-separated preset tags; only matching entries are processed. Overrides config defaultPresets.
  --all                   Ignore config defaultPresets and process all configured entries.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --silent                Suppress per-file output; print only final summary line.
  --verbose, -v           Print detailed step information.
  --help                  Print this help text.
  --version               Print version.

Exit codes: 0 success | 1 error
`);
      break;

    case 'check':
      console.log(`
Usage: filedist check [options]

Verify that locally extracted files match their package sources.

Options:
  --packages <specs>      Comma-separated package specs. Overrides config sets.
  --output, -o <dir>      Output directory path.
  --files <globs>         Glob patterns for file selection.
  --content-regex <re>    Regex strings for content filtering.
  --managed [bool]        Silently skip unmanaged entries. Use --managed=false.
  --presets <tags>        Comma-separated preset tags; only matching entries are checked. Overrides config defaultPresets.
  --all                   Ignore config defaultPresets and check all configured entries.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --verbose, -v           Print detailed comparison information.
  --help                  Print this help text.

Exit codes: 0 all in sync | 1 drift detected or error
`);
      break;

    case 'list':
      console.log(`
Usage: filedist list [options]

Print all files currently managed by filedist in the output directory.

Options:
  --output, -o <dir>      Output directory to inspect.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --verbose, -v           Print additional metadata per file.
  --help                  Print this help text.

Output format: <relPath>  <packageName>@<packageVersion>
Exit codes: 0 always
`);
      break;

    case 'purge':
      console.log(`
Usage: filedist purge [options]

Remove all managed files from the output directory.

Options:
  --packages <specs>      Comma-separated package specs. Limits purge to matching entries.
  --output, -o <dir>      Output directory to purge.
  --presets <tags>        Comma-separated preset tags; only matching entries are purged. Overrides config defaultPresets.
  --all                   Ignore config defaultPresets and purge all configured entries.
  --dry-run               Print what would be removed without deleting.
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --silent                Suppress per-file output.
  --verbose, -v           Print detailed deletion steps.
  --help                  Print this help text.

Exit codes: 0 purge complete | 1 error during deletion
`);
      break;

    case 'init':
      console.log(`
Usage: filedist init [options]

Scaffold a new publishable npm data package.

Options:
  --output, -o <dir>      Directory to scaffold into (default: current dir).
  --verbose, -v           Print scaffolding steps.
  --help                  Print this help text.

Created files: package.json, bin/filedist.js
Exit codes: 0 success | 1 target dir has conflicting files
`);
      break;

    case 'presets':
      console.log(`
Usage: filedist presets

List all unique preset tags defined in the configuration.
Presets are declared in each entry's "presets" field and can be used
to selectively run extract, check, or purge via --presets <tag>.

Options:
  --config <file>         Path to a config file (overrides auto-discovered .filedistrc / package.json).
  --help                  Print this help text.

Output format: one preset per line, sorted alphabetically
Exit codes: 0 success | 1 no configuration found
`);
      break;

    default:
      console.log(`
Usage: filedist [command] [options]

Commands:
  extract (default)  Extract files from npm packages
  check              Verify extracted files match package sources
  list               List all managed files
  purge              Remove managed files
  init               Scaffold a publishable data package
  presets            List all preset tags defined in configuration

Run 'filedist <command> --help' for command-specific help.
Version: ${VERSION}
`);
  }
}

export function printVersion(): void {
  // Try to read version from package.json
  console.log(`filedist v${VERSION}`);
}
