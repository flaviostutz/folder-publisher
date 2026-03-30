# filedist

Publish folders as npm packages or git repositories and extract them in any workspace. Use it to distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry or directly from git.

## How it works

- **Publisher**: a project that has folders to share. Running `init` prepares its `package.json` so those folders are included when the package is published.
- **Consumer**: any project that installs that package and runs `extract` to download the files locally. A `.filedist` marker file is written alongside the managed files to track ownership and enable safe updates.

## Extraction patterns

There are three ways to extract data with `filedist`. Choose the one that fits your situation:

### Pattern 1 — Ad-hoc CLI extraction

Use `npx filedist extract` directly from the command line whenever you need to pull files from a package without any prior setup.

```sh
npx filedist extract --packages my-shared-assets@^2.0.0 --output ./data

# or use a git repository as the source
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

Package specs support optional source prefixes. Use `git:` for git repositories and `npm:` when you want to make the npm source explicit. When no prefix is present, filedist treats the spec as npm. Git specs accept full repository URLs and host/path shorthands such as `git:github.com/org/repo.git@ref`.

### Pattern 2 — Data packages with embedded configuration

Create a dedicated npm package whose `package.json` declares an `filedist` config block. That config encodes the extraction sources, output directories, filtering rules, and any combination of upstream packages. Consumers install the data package and run its bundled script — they don't need to know the internals.

**Publisher** — add an `filedist` block to the data package's `package.json`:

```json
{
  "name": "my-org-configs",
  "version": "1.0.0",
  "filedist": {
    "sets": [
      {
        "package": "base-datasets@^3.0.0",
        "selector": { "files": ["datasets/**"] },
        "output": { "path": "./data/base" }
      },
      {
        "package": "org-configs@^1.2.0",
        "selector": { "contentRegexes": ["env: production"] },
        "output": { "path": "./configs" }
      },
      {
        "package": "git:github.com/flaviostutz/xdrs-core@1.3.0",
        "selector": { "files": ["docs/**"] },
        "output": { "path": "./xdrs" }
      }
    ]
  }
}
```

Run `pnpm dlx filedist init` in that package and then `npm publish` to release it.

**Consumer** — just install and run:

```sh
npx my-org-configs extract --output ./local-data
```

No knowledge of the upstream packages or transformation rules is required.

**When to use:** When an intermediary team (a platform, infrastructure, or data team) wants to bundle, curate, and version a collection of data from multiple sources and hand it to consumers as a single, opinionated package. Consumers get a stable, self-describing interface; producers control all the complexity.

### Pattern 3 — Config file mode

Add an `filedist` configuration directly to a project's own `package.json` (or a `.filedistrc` file) and then run `filedist extract` without `--packages`. The CLI automatically loads the configuration and runs every entry, reusing the same runner logic as data packages.

**Consumer** — declare the config inline in `package.json`:

```json
{
  "name": "my-project",
  "filedist": {
    "defaultPresets": ["prod"],
    "sets": [
      {
        "package": "base-datasets@^3.0.0",
        "selector": { "files": ["datasets/**"] },
        "output": { "path": "./data" }
      },
      {
        "package": "git:github.com/flaviostutz/xdrs-core@1.3.0",
        "selector": { "files": ["docs/**"] },
        "output": { "path": "./xdrs" }
      }
    ]
  }
}
```

Or write a standalone `.filedistrc` (JSON object at the top level):

```json
{
  "sets": [
    {
      "package": "base-datasets@^3.0.0",
      "selector": { "files": ["datasets/**"] },
      "output": { "path": "./data" }
    },
    {
      "package": "git:file:///absolute/path/to/local-repo@v2.0.0",
      "selector": { "files": ["conf/**"] },
      "output": { "path": "./local-conf" }
    }
  ]
}
```

Then run any command without `--packages`:

```sh
npx filedist           # same as 'npx filedist extract'
npx filedist extract   # reads config, extracts all entries or only defaultPresets when defined
npx filedist check     # checks the same effective set selection
npx filedist purge     # purges the same effective set selection
```

Config is resolved using [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). Sources searched in order from the current directory:

| Source | Key / format |
|---|---|
| `package.json` | `"filedist"` key — object with `"sets"` array |
| `.filedistrc` | JSON or YAML object with `"sets"` array |
| `.filedistrc.json` | JSON object with `"sets"` array |
| `.filedistrc.yaml` / `.filedistrc.yml` | YAML object with `"sets"` array |
| `filedist.config.js` | CommonJS module exporting object with `sets` array |

All runner flags (`--dry-run`, `--silent`, `--verbose`, `--gitignore=false`, `--managed=false`, `--presets`, `--output`) work as usual.
When `filedist.defaultPresets` is defined, `extract`, `check`, and `purge` behave as if `--presets <tags>` had been passed automatically. Passing `--presets` explicitly overrides that configured default for the current invocation.

Config-file mode can mix npm packages and git repositories in the same `sets` array. Use the `git:` prefix for git entries.

**When to use:** When a consuming project wants to pin and automate a set of data extractions locally without publishing a separate data package. This is the lightest-weight approach — no extra package, no `init` step, just a config block and a single CLI call.

---

## Quick start

### 1. Prepare the publisher package

In the project whose folders you want to share:

```sh
# share specific folders by glob pattern (required)
pnpm dlx filedist init --files "docs/**,data/**,configs/**"

# also bundle an additional package so consumers get data from both sources
pnpm dlx filedist init --files "docs/**" --packages shared-configs@^1.0.0

# share multiple upstream sources, including git
pnpm dlx filedist init --files "docs/**" --packages "shared-configs@^1.0.0,git:github.com/flaviostutz/xdrs-core@1.3.0"

```

`init` updates `package.json` with the right `files`, `bin`, and `dependencies` fields so those folders are included when the package is published, and writes a thin `bin/filedist.js` entry point. Then publish normally:

```sh
npm publish
```

### 2. Extract files in a consumer project

```sh
# npm package examples
npx filedist extract --packages my-shared-assets --output ./data
npx filedist extract --packages my-shared-assets@^2.0.0 --output ./data
npx filedist extract --packages "my-shared-assets@^2.0.0,another-pkg@1.x" --output ./data
npx filedist extract --packages my-shared-assets --files "**/*.md" --output ./docs
npx filedist extract --packages my-shared-assets --content-regex "env: production" --output ./configs
npx filedist extract --packages my-shared-assets --output ./data --force
npx filedist extract --packages my-shared-assets --output ./data --gitignore=false
npx filedist extract --packages my-shared-assets --output ./data --managed=false
npx filedist extract --packages my-shared-assets --output ./data --dry-run
npx filedist extract --packages my-shared-assets@latest --output ./data --upgrade

# git source examples
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@main --output ./xdrs
npx filedist extract --packages "https://github.com/org/repo-a@v1.0.0,file:///tmp/repo-b@main" --output ./git-data
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --files "docs/**/*.md" --output ./docs
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --content-regex "Decision Outcome" --output ./filtered-docs
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --force
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --gitignore=false
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --managed=false
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --dry-run
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@main --output ./xdrs --upgrade
```

`extract` logs every file change as it happens:

```
A	data/users-dataset/user1.json
M	data/configs/app.config.json
D	data/old-file.json
```

If the published package includes its own bin script (normally when it's prepared using "init") you can also call it directly so it extracts data that is inside the package itself:

```sh
npx my-shared-assets extract --output ./data
npx my-shared-assets check  --output ./data
```

When the data package defines multiple `filedist` entries in its `package.json`, you can limit which entries are processed using the `--presets` option. Only entries whose `presets` list includes at least one of the requested presets will be extracted; entries with no presets are skipped when a preset filter is active.

```sh
# run only entries tagged with "prod"
npx my-shared-assets --presets prod

# run entries tagged with either "prod" or "staging"
npx my-shared-assets --presets prod,staging
```

To use presets, add a `presets` array to each `filedist` entry in the data package's `package.json`:

```json
{
  "filedist": {
    "sets": [
      { "package": "my-shared-assets", "output": { "path": "./data" }, "presets": ["prod"] },
      { "package": "my-dev-assets",    "output": { "path": "./dev-data" }, "presets": ["dev", "staging"] }
    ]
  }
}
```

Check the /examples folder to see this in action

### Data package CLI options

When calling the bin script bundled in a data package, the following options are accepted. Options that overlap with per-entry settings override every entry globally, regardless of what is set in `package.json`.

| Option | Description |
|---|---|
| `--output, -o <dir>` | Base directory for resolving all `output.path` values (default: cwd). |
| `--presets <preset1,preset2>` | Limit to entries whose `presets` overlap with the given list (comma-separated). |
| `--nosync [bool]` | Keep stale managed files on disk during extract instead of deleting them. `check` still reports them as extra drift. |
| `--gitignore [bool]` | Disable `.gitignore` management for every entry when set to `false`, overriding each entry's `gitignore` field. |
| `--managed [bool]` | Run every entry in unmanaged mode when set to `false`, overriding each entry's `managed` field. Files are written without a `.filedist` marker, without `.gitignore` updates, and without being made read-only. |
| `--dry-run` | Simulate changes without writing or deleting any files. |
| `--verbose, -v` | Print detailed progress information for each step. |

```sh
# disable gitignore management across all entries
npx my-shared-assets --gitignore=false

# keep stale managed files on disk during extract
npx my-shared-assets --nosync

# write all files as not-managed (editable, not tracked)
npx my-shared-assets --managed=false

# combine overrides
npx my-shared-assets --gitignore=false --managed=false --dry-run
```

### filedist entry options reference

Each entry in the `filedist.sets` array in `package.json` supports the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `package` | `string` | required | Source spec to install and extract. Either npm (`my-pkg`, `npm:my-pkg@^1.2.3`) or git (`git:github.com/org/repo.git@ref`, `git:file:///tmp/repo@main`). |
| `output.path` | `string` | `.` (cwd) | Directory where files will be extracted, relative to where the consumer runs the command. |
| `selector.files` | `string[]` | all files | Glob patterns to filter which files are extracted (e.g. `["data/**", "*.json"]`). |
| `selector.exclude` | `string[]` | `["package.json","bin/**","README.md","node_modules/**"]` (when `files` is unset), none otherwise | Glob patterns to exclude files even when they match `selector.files` (e.g. `["test/**", "**/*.test.*"]`). |
| `selector.contentRegexes` | `string[]` | none | Regex patterns (as strings) to filter files by content. Only files matching at least one pattern are extracted. |
| `output.force` | `boolean` | `false` | Allow overwriting existing files or files owned by a different package. |
| `output.keepExisting` | `boolean` | `false` | Skip files that already exist but create them when absent. Cannot be combined with `force`. |
| `output.noSync` | `boolean` | `false` | Keep stale managed files on disk during extract instead of deleting them. `check` still reports them as extra drift until they are removed or synced. |
| `output.gitignore` | `boolean` | `true` | Create/update a `.gitignore` file alongside each `.filedist` marker file. Set to `false` to disable. |
| `output.managed` | `boolean` | `true` | Write files with a `.filedist` marker, `.gitignore` update, and read-only flag. Set to `false` to skip tracking. Existing files are skipped when set to `false`. |
| `output.dryRun` | `boolean` | `false` | Simulate extraction without writing anything to disk. |
| `selector.upgrade` | `boolean` | `false` | Force a fresh install of the package even when a satisfying version is already installed. |
| `silent` | `boolean` | `false` | Suppress per-file output, printing only the final result line. |
| `presets` | `string[]` | none | Presets used to group and selectively run entries with `--presets`. |
| `output.symlinks` | `SymlinkConfig[]` | none | Post-extract symlink operations (see below). |
| `output.contentReplacements` | `ContentReplacementConfig[]` | none | Post-extract content-replacement operations (see below). |

Top-level config fields:

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultPresets` | `string[]` | none | CLI-only fallback for config-file mode. `extract`, `check`, and `purge` behave as if `--presets <tags>` had been passed when the flag is omitted. |

#### SymlinkConfig

After extraction, for each config the runner resolves all files/directories inside `output.path` that match `source` and creates a corresponding symlink inside `target`. Stale symlinks pointing into `output.path` but no longer matched are removed automatically.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Glob pattern relative to `output.path`. Every matching file or directory gets a symlink in `target`. Example: `"**\/skills\/**"` |
| `target` | `string` | Directory where symlinks are created, relative to the project root. Example: `".github/skills"` |

#### ContentReplacementConfig

After extraction, for each config the runner finds workspace files matching `files` and applies the regex replacement to their contents.

| Field | Type | Description |
|---|---|---|
| `files` | `string` | Glob pattern (relative to the project root) selecting workspace files to modify. Example: `"docs/**\/*.md"` |
| `match` | `string` | Regex string locating the text to replace. Applied globally to all non-overlapping occurrences. Example: `"<!-- version: .* -->"` |
| `replace` | `string` | Replacement string. May contain regex back-references such as `$1`. Example: `"<!-- version: 1.2.3 -->"` |

Example with multiple options:

```json
{
  "filedist": {
    "sets": [
      {
        "package": "my-shared-assets@^2.0.0",
        "selector": {
          "files": ["docs/**", "configs/*.json"],
          "upgrade": true
        },
        "output": {
          "path": "./data",
          "gitignore": true,
          "symlinks": [
            { "source": "**\/skills\/**", "target": ".github/skills" }
          ],
          "contentReplacements": [
            { "files": "docs/**\/*.md", "match": "<!-- version: .* -->", "replace": "<!-- version: 2.0.0 -->" }
          ]
        },
        "presets": ["prod"]
      },
      {
        "package": "git:github.com/flaviostutz/xdrs-core@1.3.0",
        "selector": {
          "files": ["docs/**"],
          "upgrade": true
        },
        "output": {
          "path": "./xdrs",
          "gitignore": false
        },
        "presets": ["prod"]
      }
    ]
  }
}
```

### 3. Check files are in sync

Verifies that every file in the output directory matches what is currently in the published package. When the target package itself declares `filedist.sets`, check recurses into those transitive dependencies — reporting drift at every level of the hierarchy without downloading anything new beyond what is already installed. Use `selector.presets` on an entry to restrict which of the target's sets are checked.

```sh
npx filedist check --packages my-shared-assets --output ./data
# exit 0 = in sync, exit 1 = drift or error

# check multiple packages
npx filedist check --packages "my-shared-assets,another-pkg" --output ./data
```

The check command reports differences per package:

```
  my-shared-assets@2.1.0: out of sync
    - missing:  data/new-file.json
    ~ modified: data/configs/app.config.json
    + extra:    data/old-file.json
```

### 4. List managed files

```sh
# list all files managed by filedist in an output directory
npx filedist list --output ./data
```

Output is grouped by package:

```
my-shared-assets@2.1.0
  data/users-dataset/user1.json
  data/configs/app.config.json

another-pkg@1.0.0
  data/other-file.txt
```

### 5. Purge managed files

Remove all files previously extracted by one or more packages without touching any other files in the output directory. No network access or package installation is required — only the local `.filedist` marker state is used. When the target package itself declares `filedist.sets`, purge recurses into those transitive dependencies and removes their managed files too, mirroring what extract originally created.

```sh
# remove all files managed by a package
npx filedist purge --packages my-shared-assets --output ./data

# purge multiple packages at once
npx filedist purge --packages "my-shared-assets,another-pkg" --output ./data

# preview what would be deleted without removing anything
npx filedist purge --packages my-shared-assets --output ./data --dry-run
```

After a purge, the corresponding entries are removed from the `.filedist` marker file and any empty directories are cleaned up. `.gitignore` sections written by `extract` are also removed.

## Hierarchical package resolution

`extract`, `check`, and `purge` are all hierarchy-aware: when a target package or git repository carries its own `filedist.sets` block in its `package.json` or `.filedistrc*`, the command automatically recurses into those transitive dependencies.

This lets you build layered data package chains:

```
consumer project
  └─ my-org-configs          (npm package with filedist.sets)
       ├─ base-datasets       (another npm package with its own files)
       └─ org-templates       (another npm package with its own files)
            └─ raw-assets     (leaf package)
```

Running `npx filedist extract --packages my-org-configs --output ./data` will extract files from every package in the chain, not just `my-org-configs` itself.

When the source is git, filedist clones repositories into `.filedist-tmp` inside the working directory, adds that folder to `.gitignore` if needed, resolves nested config from the cloned repository, and removes `.filedist-tmp` when the command ends.

### Output path resolution

Each level's `output.path` is resolved relative to the caller's own `output.path`. A package at depth 1 with `output.path: "./configs"` and a transitive dependency with `output.path: "./shared"` will land at `./configs/shared`.

### Caller overrides (extract only)

When `extract` recurses, the caller's `output` flags are inherited by every transitive dependency, with caller-defined values always winning:

| Caller sets | Effect on transitive entries |
|---|---|
| `force: true` | Transitive entries also overwrite unmanaged / foreign files |
| `dryRun: true` | No files are written anywhere in the hierarchy |
| `keepExisting: true` | Existing files are skipped at every level |
| `gitignore: false` | No `.gitignore` entries are created anywhere |
| `managed: false` | All transitive files are written without a marker or read-only flag |
| `symlinks` / `contentReplacements` | Appended to each transitive entry's own lists |

Settings that are undefined on the caller are left as-is so the transitive package's own defaults apply.

### Filtering transitive sets with `selector.presets`

Set `selector.presets` on an entry to control which sets inside the target package are recursed into. Only sets whose `presets` tag overlaps with the filter are processed; sets with no `presets` are skipped when a filter is active.

```json
{
  "filedist": {
    "sets": [
      {
        "package": "my-org-configs@^2.0.0",
        "output": { "path": "./data" },
        "selector": { "presets": ["prod"] }
      }
    ]
  }
}
```

The same filtering is applied during `check` and `purge` so they stay in sync with what `extract` originally wrote.

### Circular dependency detection

If a package chain references itself (directly or transitively), the command stops immediately with an error rather than looping forever. Sibling packages — entries already being processed at the same level — are also skipped to prevent double-processing.

## CLI reference

```
Usage:
  npx filedist [init|extract|check|list|purge] [options]

Commands:
  init      Set up publishing configuration in a package
  extract   Extract files from a published package into a local directory
  check     Verify local files are in sync with the published package
  list      List all files managed by filedist in an output directory
  purge     Remove all managed files previously extracted by given packages

Global options:
  --help, -h       Show help
  --version        Show version

Init options:
  --files <patterns>       Comma-separated glob patterns of files to publish
                           e.g. "docs/**,data/**,configs/*.json"
  --packages <specs>       Comma-separated additional package specs to bundle as data sources.
                           Each spec is "name" or "name@version", e.g.
                           "shared-configs@^1.0.0,base-templates@2.x".
                           Added to `dependencies` so consumers pull data from all of them.
  --output, -o <dir>       Directory to scaffold into (default: current directory)

Extract options:
  --packages <specs>       Comma-separated package specs.
                           When omitted, filedist searches for a configuration file
                           (package.json "filedist" key, .filedistrc, etc.) and runs all
                           entries defined there.
                           Each spec is `name`, `name@version`, `npm:name@version`, or
                           `git:github.com/org/repo.git@ref`, e.g.
                           "my-pkg@^1.0.0,git:github.com/org/repo.git@main"
  --output, -o <dir>       Output directory (default: current directory)
  --force                  Overwrite existing files or files owned by a different package
  --keep-existing          Skip files that already exist; create them when absent. Cannot be
                           combined with --force
  --gitignore [bool]       Disable .gitignore management when set to false (enabled by default)
  --managed [bool]         Set to false to write files without a .filedist marker, .gitignore
                           update, or read-only flag. Existing files are skipped. Files can be
                           freely edited afterwards and are not tracked by filedist.
  --files <patterns>       Comma-separated glob patterns to filter files
  --content-regex <regex>  Regex to filter files by content
  --dry-run                Preview changes without writing any files
  --upgrade                Reinstall the package even if already present
  --silent                 Print only the final result line, suppressing per-file output
  --verbose, -v            Print detailed progress information for each step

Check options:
  --packages <specs>       Same format as extract.
                           When omitted, reads from a configuration file (see Pattern 3).
  --output, -o <dir>       Output directory to check (default: current directory)

Purge options:
  --packages <specs>       Comma-separated package names whose managed files should be removed.
                           When omitted, reads from a configuration file (see Pattern 3).
  --output, -o <dir>       Output directory to purge from (default: current directory)
  --dry-run                Simulate purge without removing any files
  --silent                 Suppress per-file output

List options:
  --output, -o <dir>       Output directory to inspect (default: current directory)
```

## Library usage

`filedist` also exports a programmatic API:

```typescript
import { actionExtract, actionCheck, actionList, actionPurge } from 'filedist';
import type { FiledistExtractEntry, ProgressEvent } from 'filedist';

const entries: FiledistExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
];
const cwd = process.cwd();

// extract files
const result = await actionExtract({ entries, cwd });
console.log(result.added, result.modified, result.deleted);

// dry-run: preview changes without writing files
const dryResult = await actionExtract({ entries: entries.map(e => ({ ...e, output: { ...e.output, dryRun: true } })), cwd });
console.log('Would add', dryResult.added, 'files');

// track progress file-by-file
await actionExtract({
  entries,
  cwd,
  onProgress: (event: ProgressEvent) => {
    if (event.type === 'file-added')    console.log('A', event.file);
    if (event.type === 'file-modified') console.log('M', event.file);
    if (event.type === 'file-deleted')  console.log('D', event.file);
  },
});

// check sync status
const summary = await actionCheck({ entries, cwd });
const hasDrift = summary.missing.length > 0 || summary.modified.length > 0 || summary.extra.length > 0;
if (hasDrift) {
  console.log('Missing:', summary.missing);
  console.log('Modified:', summary.modified);
  console.log('Extra:', summary.extra);
}

// remove all managed files (no network required)
await actionPurge({ entries, config: null, cwd });

// list all files managed by filedist in an output directory
const managed = await actionList({ entries, config: null, cwd });
// ManagedFileMetadata[]: Array<{ path: string; packageName: string; packageVersion: string }>
```

### `ProgressEvent` type

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end';   packageName: string; packageVersion: string }
  | { type: 'file-added';    packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted';  packageName: string; file: string }
  | { type: 'file-skipped';  packageName: string; file: string };
```

See the root [README.md](../README.md) for the full documentation.

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.filedist` marker file in each output directory. On subsequent extractions:

- Unchanged files are skipped.
- Updated files are overwritten.
- Files removed from the package are deleted locally.

The marker file uses a `|`-delimited format; files written by older versions of `filedist` using the comma-delimited format are read correctly for backward compatibility.

Multiple packages can coexist in the same output directory; each owns its own files.

## Developer Notes

### Module overview

| Folder / file | Purpose |
|---|---|
| `src/cli/` | CLI entry-points: argument parsing, help text, config loading, per-command handlers |
| `src/package/` | Package-level orchestration: config resolution, fileset iteration, purge and init coordination |
| `src/fileset/` | File-level extraction, diff, check, and sync logic |
| `src/types.ts` | Shared TypeScript types |
| `src/utils.ts` | Low-level utilities: package install, glob/hash helpers, package manager detection |
| `src/index.ts` | Public API surface |

### Marker file (`.filedist`)

Each output directory that contains managed files gets a `.filedist` CSV file. Columns: `path`, `packageName`, `packageVersion` — one row per file, no header. This is the source of truth for ownership tracking and clean removal.

### Key design decisions

- File identity is tracked by path + hash, not by timestamp, to be deterministic across machines.
- Extract uses a two-phase diff + execute model: compute all changes first, then apply them, enabling conflict detection and rollback before any file is written.
- The bin shim generated by `filedist init` contains no logic; all behaviour is versioned inside this library.

### Dev workflow

```
make build lint-fix test
```
