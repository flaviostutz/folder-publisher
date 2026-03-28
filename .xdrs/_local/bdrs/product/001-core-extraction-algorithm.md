# _local-bdr-001: Core extraction algorithm

## Context and Problem Statement

npmdata must support multi-level package composition: a consumer may reference a data package that itself references other data packages, each with their own file selectors, output paths, and presets. File extraction must be predictable, composable, and actionable by multiple commands (extract, check, purge) without duplicating logic.

How should the extraction algorithm handle config inheritance, file selection, and output resolution across multiple package levels?

## Decision Outcome

**Two-phase recursive extraction with config inheritance**

Extraction is split into a read-only diff phase and an action phase. Config flows top-down through recursive package resolution, with well-defined merge rules at each level.

### Implementation Details

**Phase 1 — Build diff (read-only)**

Given `(packageName, version/ref, selectorConfig, outputConfig, source)`:

1. Resolve the source package: install from npm or clone from git into `.npmdata-tmp`.
2. Load config for the resolved package root (from its `package.json` or `.npmdatarc`).
3. If no config is found: call `extractFileset(packageName, version/ref, selectorConfig, outputConfig)` — directly walk and filter the package files to produce a diff (add/modify/delete/skip).
4. If config is found, for each fileset entry in config:
   - Merge the entry's selector and output config with the incoming `selectorConfig`/`outputConfig` using the merge rules below.
   - If the entry's package is the current package: call `extractFileset(currentPackage, version, mergedSelector, mergedOutput)`.
   - Otherwise: call `extractPackage(entry.package, entry.version, mergedSelector, mergedOutput)` — recursion, so config inheritance propagates downward.

**Phase 2 — Execute action**

Given the full diff produced in Phase 1:
- `extract`: write/delete files to disk (skipped when `dryRun`). File deletions are deferred until all filesets are processed so a file claimed by one package can be superseded by another in the same run.
- `check`: compare hashes, report differences.
- `purge`: delete files using only the local `.npmdata` marker — no network access needed.

When the source is git, the clone lives in `.npmdata-tmp/<hashed-repo-dir>` during the command and is deleted afterwards.

**Merge rules (applied at step 3 of Phase 1)**

| Aspect | Rule |
|---|---|
| `selector.files` patterns | AND — both the incoming and entry patterns must match |
| `selector.contentRegexes` | AND — file must match at least one regex from each level |
| `output` flags (`force`, `managed`, `gitignore`, etc.) | Higher caller overrides lower package |
| `presets` | Not inherited — only used at the current level to select which entries to run |
| `output.symlinks` | Appended — all levels' symlink configs are combined |
| `output.contentReplacements` | Appended — all levels' replacement configs are combined |
| `output.path` | Concatenated — `[caller path]/[package 1 path]/[package 2 path]` |

**Example**

```
security-rules  → /security/rules.md
devops-rules    → /devops/rules.md, /security/script.sh
myorg-kit       → /myorg/welcome.md
  sets:
    { package: myorg-kit,      files: myorg/**,    presets: [basic, extended] }
    { package: devops-rules,   files: devops/**,   presets: [basic, extended] }
    { package: security-rules, files: security/**, presets: [extended] }

consumer (.npmdatarc):
  sets:
    { package: myorg-kit, files: *.md }
```

Consumer calls `extract --presets basic`. Result:
- `myorg-kit` entry (basic): extracts `myorg/**` AND `*.md` → `/myorg/welcome.md`
- `devops-rules` entry (basic): extracts `devops/**` AND `*.md` → `/devops/rules.md`
- `security-rules` entry: skipped (preset `extended` not requested)
- `/security/script.sh` excluded by the `*.md` filter inherited from the consumer

**CLI equivalences**

```
npx npmdata extract --packages myorg-kit
npx myorg-kit extract
npx npmdata extract   # (with .npmdatarc set pointing to myorg-kit)
```

```
npx npmdata extract --packages myorg-kit --presets basic
npx myorg-kit extract --presets basic
```

**CLI / lib separation**

The CLI layer `cli/` must contain only argument parsing, console output, and user-facing error handling. All extraction, check, purge, and list logic must live in `package/` and `fileset/` modules.
