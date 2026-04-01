# filedist

Publish folders as npm packages or git repositories and extract them in any workspace. Distribute shared assets — ML datasets, documentation, ADRs, configuration files — across multiple projects through any npm-compatible registry or directly from git.

## Getting Started

```sh
# extract files from any npm package into a local directory
npx filedist extract --packages my-shared-assets@^2.0.0 --output ./data

# extract directly from git
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

```typescript
import { actionExtract } from 'filedist';
import type { FiledistExtractEntry } from 'filedist';

const entries: FiledistExtractEntry[] = [
  { package: 'my-shared-assets@^2.0.0', output: { path: './data' } },
  {
    package: 'git:github.com/flaviostutz/xdrs-core@1.3.0',
    output: { path: './xdrs' },
  },
];
const result = await actionExtract({ entries, cwd: process.cwd() });
console.log(result.added, result.modified, result.deleted);
```

Package specs support optional source prefixes. Use `git:` for git repositories and `npm:` when you want to make the npm source explicit. When no prefix is present, filedist treats the spec as npm. Git specs accept full repository URLs and host/path shorthands such as `git:github.com/org/repo.git@ref`.

---

## Guides

- [How to share dataset files with filedist](docs/share-dataset-files-with-filedist.md)

---

## How it works

- **Publisher**: a project, npm package, or plain git repository whose folders you want to share. Running `init` prepares its `package.json` so those folders are included when published.
- **Consumer**: any project that installs that package and runs `extract` to pull the files locally. A `.filedist` marker file tracks ownership and enables safe updates.

Publishers can also carry their own `filedist` config in `package.json` or `.filedistrc`, including `sets` entries. That works the same whether the publisher is consumed from npm or directly from git.

---

## Scenario 1 — Ad-hoc CLI extraction

Pull files directly without any setup:

```sh
# npm package examples
npx filedist extract --packages my-shared-assets@^2.0.0 --output ./data
npx filedist extract --packages my-shared-assets --files "**/*.md" --output ./docs
npx filedist extract --packages my-shared-assets --content-regex "env: production" --output ./configs
npx filedist extract --packages my-shared-assets --output ./data --dry-run

# git source examples
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --files "docs/**/*.md" --output ./docs
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --content-regex "Decision Outcome" --output ./filtered-docs
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --dry-run
```

---

## Scenario 2 — Config file in your project

Declare sources in `.filedistrc` (or `package.json`) and run `extract` without `--packages`:

```json
{
  "defaultPresets": ["prod"],
  "sets": [
    {
      "package": "base-datasets@^3.0.0",
      "selector": { "files": ["datasets/**"] },
      "output": { "path": "./data" }
    },
    {
      "package": "org-templates@^1.2.0",
      "selector": { "files": ["templates/**"] },
      "output": { "path": "./templates" }
    },
    {
      "package": "git:github.com/flaviostutz/xdrs-core@1.3.0",
      "selector": { "files": ["docs/**"] },
      "output": { "path": "./xdrs" }
    },
    {
      "package": "git:file:///absolute/path/to/local-repo@v2.0.0",
      "selector": { "files": ["conf/**"] },
      "output": { "path": "./local-conf" }
    }
  ]
}
```

For a local Windows path, use the same `file://` form with a drive letter, for example `git:file:///C:/work/local-repo@v2.0.0`.

```sh
npx filedist extract   # reads config, extracts all sets or only defaultPresets when defined
npx filedist check     # verifies files are in sync for the same effective set selection
npx filedist purge     # removes managed files for the same effective set selection
```

After `extract`, the output directory will contain the selected files alongside a `.filedist` marker file that tracks ownership and enables safe updates:

```
./data/
  datasets/
    sample.csv
    labels.csv
  .filedist              ← tracks file ownership (package name + version)
```

Config is resolved looking at files: `package.json` (`"filedist"` key), `.filedistrc`, `.filedistrc.json`, `.filedistrc.yaml`, or `filedist.config.js`. Pass `--config <file>` to point to an explicit config file and skip auto-discovery.

When `defaultPresets` is defined at the root of the config, `extract`, `check`, and `purge` behave the same as if `--presets <tags>` had been passed. An explicit `--presets` flag overrides the configured default for that invocation.
Use `--all` to ignore `defaultPresets` for one command and process every configured entry.

The same config file can mix npm packages and git repositories. Use the `git:` prefix for git entries. A git repository source can also provide its own `.filedistrc` or `package.json#filedist` with `sets`, and those nested sets participate in the same hierarchical resolution.

### Example — Prepare a git repository source

If you want a plain git repository to behave like a publisher, put the files you want to expose in the repo and add a root `.filedistrc` describing its own files and any nested upstream sources:

```text
shared-assets-repo/
  .filedistrc
  docs/
    README.md
  data/
    users-dataset/
  configs/
    app.json
```

.filedistrc
```json
{
  "sets": [
    {
      "selector": { "files": ["docs/**", "data/**"] },
      "output": { "path": "." },
      "presets": ["base"]
    },
    {
      "selector": { "files": ["configs/**"] },
      "output": { "path": "./conf" },
      "presets": ["runtime"]
    },
    {
      "package": "git:github.com/my-org/shared-policies@v1.4.0",
      "selector": { "files": ["policies/**"] },
      "output": { "path": "./vendor/policies" },
      "presets": ["runtime"]
    }
  ]
}
```

Commit and tag that repository, then consume it like any other source:

```sh
npx filedist extract --packages git:github.com/my-org/shared-assets-repo@v1.0.0 --output ./assets
npx filedist extract --packages git:github.com/my-org/shared-assets-repo@v1.0.0 --output ./assets --presets runtime
```

In this setup, filedist clones the repository, reads the root `.filedistrc`, extracts the repo's own files from the self entries that omit `package`, and then follows any external `sets` entries recursively.

---

## Scenario 3 — Data package (curated bundle for consumers)

A data package bundles, filters, and versions content from multiple upstream sources. Consumers install it and run one command — no knowledge of the internals required.

**Step 1 — Create the data package**

```sh
# in the data package directory
pnpm dlx filedist init --files "docs/**,data/**"

# also pull from upstream npm packages and git repositories
pnpm dlx filedist init --files "docs/**" --packages "shared-configs@^1.0.0,git:github.com/flaviostutz/xdrs-core@1.3.0"
```

`init` updates `package.json` with the right `files`, `bin`, and `dependencies` and writes a `bin/filedist.js` entry point. Then:

```sh
npm publish
```

**Step 2 — Add configuration to the data package's `package.json`**

```json
{
  "name": "my-org-configs",
  "version": "1.0.0",
  "filedist": {
    "sets": [
      {
        "selector": { "files": ["docs/**", "data/**"] },
        "output": { "path": "." },
        "presets": ["prod"]
      },
      {
        "package": "base-datasets@^3.0.0",
        "selector": { "files": ["datasets/**"] },
        "output": { "path": "./data/base" },
        "presets": ["prod"]
      },
      {
        "package": "org-configs@^1.2.0",
        "selector": {
          "contentRegexes": ["env: production"],
          "presets": ["reports"]
        },
        "output": { "path": "./configs" },
        "presets": ["prod", "staging"]
      },
      {
        "package": "git:github.com/flaviostutz/xdrs-core@1.3.0",
        "selector": { "files": ["docs/**"] },
        "output": { "path": "./xdrs" },
        "presets": ["prod"]
      }
    ]
  }
}
```

In a package's own `filedist.sets`, omit `package` to mean "extract files from this package itself". Use `package` only for external dependencies.

> **`presets` vs `selector.presets`**
> - `sets[].presets` — tags **this entry** so it is only processed when `--presets <tag>` matches. Use this in a consumer config to pick which source packages to extract.
> - `sets[].selector.presets` — filters which of the **target package's own** `filedist.sets` are recursively extracted. Only the nested sets inside the target package whose `presets` fields match will run.

**Step 3 — Consumer installs and runs**

```sh
# Extract all files from this curated package to current dir
npx my-org-configs extract

# limit to a preset
npx my-org-configs extract --output ./local-data --presets prod
```

---

## All extract options

```sh
npx filedist extract --packages my-pkg@^2.0.0 --output ./data   # specific version
npx filedist extract --packages "pkg-a,pkg-b@1.x" --output ./data  # multiple packages
npx filedist extract --packages my-pkg --output ./data --force   # overwrite existing files
npx filedist extract --packages my-pkg --output ./data --managed=false  # skip tracking
npx filedist extract --packages my-pkg@latest --output ./data --upgrade  # force reinstall
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
npx filedist extract --packages "git:github.com/org/repo-a@v1.0.0,git:file:///tmp/repo-b@main" --output ./git-data  # multiple git sources
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --force   # overwrite existing files
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --managed=false  # skip tracking
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@main --output ./xdrs --upgrade  # force a fresh clone/check-out
npx filedist extract --packages my-pkg --output ./data --gitignore=false  # skip .gitignore
npx filedist extract --packages my-pkg --output ./data --dry-run  # preview only
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --gitignore=false  # skip .gitignore
npx filedist extract --packages git:github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs --dry-run  # preview only
npx filedist extract --packages my-pkg --output ./data --nosync  # keep stale managed files on disk
```

`extract` logs every file change:
```
A  data/users-dataset/user1.json
M  data/configs/app.config.json
D  data/old-file.json
```

---

## Check, list, purge and presets

`check`, `purge`, and `extract` are all **hierarchy-aware**: when a target package carries its own `filedist.sets` block, the command automatically recurses into those transitive dependencies. See [Hierarchical package resolution](#hierarchical-package-resolution) for the full details.

```sh
# verify files are in sync (exit 0 = ok, exit 1 = drift or error)
npx filedist check --packages my-shared-assets --output ./data

# list all managed files grouped by package
npx filedist list --output ./data

# remove managed files (no network required)
npx filedist purge --packages my-shared-assets --output ./data
npx filedist purge --packages my-shared-assets --output ./data --dry-run

# list all preset tags defined in your configuration
npx filedist presets
```

In config-file mode you can define a root-level `defaultPresets` array so `extract`, `check`, and `purge` automatically run the same filtered subset without requiring `--presets` every time.
Use `--all` when you want to bypass that default and process the full configured set.

---

## Entry options reference

Each entry in `filedist.sets` supports:

| Option | Type | Default | Description |
|---|---|---|---|
| `package` | `string` | none | Source spec for external entries: npm (`my-pkg`, `npm:my-pkg@^1.2.3`) or git (`git:github.com/org/repo.git@ref`, `git:file:///tmp/repo@main`, `git:file:///C:/tmp/repo@main`) |
| `presets` | `string[]` | none | Tags this entry so it is included only when the matching `--presets <tag>` flag is used. Listed by `filedist presets` |
| `output.path` | `string` | `.` (cwd) | Extraction directory, relative to where the command runs |
| `selector.files` | `string[]` | all files | Glob patterns to filter extracted files |
| `selector.contentRegexes` | `string[]` | none | Regex patterns to filter files by content |
| `selector.exclude` | `string[]` | none | Glob patterns to exclude files even if they match `selector.files` |
| `selector.presets` | `string[]` | none | Filters which of the **target package's own** `filedist.sets` are recursively extracted. Only sets in the target whose `presets` matches are processed. Does not affect which files are selected from the target package itself |
| `selector.upgrade` | `boolean` | `false` | Force fresh package install even if a satisfying version is already installed |
| `output.force` | `boolean` | `false` | Overwrite unmanaged or foreign-owned files |
| `output.keepExisting` | `boolean` | `false` | Skip files that already exist; create them when absent |
| `output.noSync` | `boolean` | `false` | Keep stale managed files on disk during extract instead of deleting them. `check` still reports them as extra drift until they are removed or synced |
| `output.gitignore` | `boolean` | `true` | Write `.gitignore` alongside managed files |
| `output.managed` | `boolean` | `true` | Write files with tracking (marker, read-only). Set to `false` to skip tracking |
| `output.dryRun` | `boolean` | `false` | Simulate without writing |
| `output.symlinks` | `SymlinkConfig[]` | none | Post-extract symlink operations |
| `output.contentReplacements` | `ContentReplacementConfig[]` | none | Post-extract content replacements |

Top-level config fields:

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultPresets` | `string[]` | none | CLI-only fallback for config-file mode. `extract`, `check`, and `purge` behave as if `--presets <tags>` had been passed when the flag is omitted |
| `postExtractCmd` | `string[]` | none | Command argv run after a successful non-dry-run `extract`. The first array item is the executable and the remaining items are its arguments. Full extract argv is appended |

### SymlinkConfig

Creates symlinks after extraction. Stale symlinks pointing into `output.path` are removed automatically.

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Glob relative to `output.path` |
| `target` | `string` | Directory for symlinks, relative to project root |

### ContentReplacementConfig

Applies regex replacements to workspace files after extraction.

| Field | Type | Description |
|---|---|---|
| `files` | `string` | Glob selecting files to modify |
| `match` | `string` | Regex locating the text to replace |
| `replace` | `string` | Replacement string (supports `$1` back-references) |

---

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

Running `npx filedist extract --packages my-org-configs --output ./data` extracts files from every package in the chain, not just `my-org-configs` itself. Running `check` or `purge` with the same arguments mirrors what `extract` originally covered.

For git sources, filedist clones each repository into `.filedist-tmp` under the working directory, adds that path to `.gitignore` if needed, reads nested `filedist` config from the cloned repository, and removes `.filedist-tmp` after the command finishes.

### Output path resolution

Each level’s `output.path` is resolved relative to the caller’s own `output.path`. A package at depth 1 with `output.path: "./configs"` that has a transitive dependency with `output.path: "./shared"` will land at `./configs/shared`.

### Caller overrides (extract only)

When `extract` recurses, the calling entry’s `output` flags are inherited by every transitive dependency, with caller-defined values always winning:

| Caller sets | Effect on transitive entries |
|---|---|
| `force: true` | Transitive entries also overwrite unmanaged / foreign files |
| `dryRun: true` | No files are written anywhere in the hierarchy |
| `keepExisting: true` | Existing files are skipped at every level |
| `gitignore: false` | No `.gitignore` entries are created anywhere |
| `managed: false` | All transitive files are written without a marker or read-only flag |
| `symlinks` / `contentReplacements` | Appended to each transitive entry’s own lists |

Settings that are undefined on the caller are left as-is so the transitive package’s own defaults apply.

### Filtering transitive sets with `selector.presets`

Set `selector.presets` on an entry to control which sets inside the target package are recursed into (applies to `extract`, `check`, and `purge`). Only sets whose `presets` tag overlaps with the filter are processed; sets with no `presets` are skipped when a filter is active.

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

### Circular dependency detection

If a package chain references itself, the command stops immediately with an error. Sibling packages — entries already being processed at the same level — are also skipped to prevent double-processing.

---

## CLI reference

```
Usage:
  npx filedist [init|extract|check|list|purge|presets] [options]

Init:     --files <patterns>    Glob patterns of files to publish
          --packages <specs>    Additional upstream packages to bundle
          --output, -o <dir>    Directory to scaffold into (default: cwd)

Extract:  --packages <specs>    Package specs (omit to read from config file)
          --output, -o <dir>    Output directory (default: cwd)
          --files <patterns>    Filter files by glob
          --content-regex <rx>  Filter files by content
          --force               Overwrite existing/foreign files
          --keep-existing       Skip existing files
          --gitignore [bool]    Disable .gitignore management when set to false
          --managed [bool]      Write without tracking when set to false
          --dry-run             Preview without writing
          --upgrade             Reinstall even if present
          --presets <tags>      Only process entries matching these preset tags
          --all                 Ignore config defaultPresets and process all configured entries
          --config <file>       Explicit config file path (overrides auto-discovery)
          --verbose, -v         Detailed progress output
          --silent              Final result line only

Check:    --packages <specs>    Same format as extract
          --output, -o <dir>    Directory to check
          --presets <tags>      Only check entries matching these preset tags
          --all                 Ignore config defaultPresets and check all configured entries
          --config <file>       Explicit config file path (overrides auto-discovery)

Purge:    --packages <specs>    Package names to purge
          --output, -o <dir>    Directory to purge from
          --dry-run             Preview without deleting
          --presets <tags>      Only purge entries matching these preset tags
          --all                 Ignore config defaultPresets and purge all configured entries
          --config <file>       Explicit config file path (overrides auto-discovery)
          --silent              Suppress per-file output

List:     --output, -o <dir>    Directory to inspect
          --config <file>       Explicit config file path (overrides auto-discovery)

Presets:  --config <file>       Explicit config file path (overrides auto-discovery)
                                Lists all preset tags defined in configuration,
                                sorted alphabetically, one per line
```

---

## Programmatic API

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

// track progress
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

// remove managed files (no network required)
await actionPurge({ entries, config: null, cwd });

// list managed files
const managed = await actionList({ entries, config: null, cwd });
// ManagedFileMetadata[]: Array<{ path: string; packageName: string; packageVersion: string }>
```

### ProgressEvent

```typescript
type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end';   packageName: string; packageVersion: string }
  | { type: 'file-added';    packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted';  packageName: string; file: string }
  | { type: 'file-skipped';  packageName: string; file: string };
```

### postExtractCmd

Set `postExtractCmd` at the top level of your config to run a command after a successful (non-dry-run) `extract`. Use an array so the executable and its arguments are passed directly without a shell. The full argv of the extract call is appended automatically.

`postExtractCmd` must be an argv array. Shell strings such as `"node scripts/post-extract.js"` are rejected with a configuration error because they are a common source of mistakes.

```json
{
  "filedist": {
    "postExtractCmd": ["node", "scripts/post-extract.js"],
    "sets": []
  }
}
```

### defaultPresets

Set `defaultPresets` at the top level of your config to make `extract`, `check`, and `purge` default to the same preset filter you would otherwise pass through `--presets`.

```json
{
  "filedist": {
    "defaultPresets": ["prod", "reports"],
    "sets": []
  }
}
```

Running `npx filedist extract` with that config behaves the same as `npx filedist extract --presets prod,reports`. Passing `--presets` explicitly overrides `defaultPresets` for that command.

---

## Managed file tracking

Extracted files are set read-only (`444`) and tracked in a `.filedist` marker file per output directory. On subsequent extractions, unchanged files are skipped, updated files are overwritten, and files removed from the package are deleted locally. Multiple packages can coexist in the same output directory — each owns its files.

See [examples/](examples/) for working samples.
