/**
 * Internal parsed representation of an npm package specifier.
 */
export type SourceKind = 'auto' | 'npm' | 'git';

/**
 * Internal parsed representation of a package specifier.
 */
export type PackageConfig = {
  /** Package name or repository URL. */
  name: string;
  /** Version/range for npm packages, or git ref for git sources. */
  version?: string;
};

export type BasicPackageOptions = {
  entries: NpmdataExtractEntry[];
  cwd: string;
  dryRun?: boolean;
  verbose?: boolean;
  silent?: boolean;
};

/**
 * Controls which files are selected from a package and install behaviour.
 */
export type SelectorConfig = {
  /**
   * Glob patterns; files must match at least one.
   * Default: all files except package.json, bin/**, README.md, node_modules/**
   */
  files?: string[];
  /**
   * Internal: grouped file patterns that must all match during recursive selector merges.
   */
  filePatternGroups?: string[][];
  /**
   * Glob patterns; files matching any of these are excluded even if they match `files`.
   */
  exclude?: string[];
  /**
   * Regex strings; files must match at least one. Binary files always skip regex check.
   */
  contentRegexes?: string[];
  /**
   * Filters which of the target package's own nested `npmdata.sets` are recursively
   * extracted. Only sets in the target package whose `presets` field includes at least
   * one of these tags will be processed. When omitted or empty, all nested sets are
   * extracted. Not applied to the files selected from the target package itself.
   */
  presets?: string[];
  /**
   * Force fresh package install even if a satisfying version is installed.
   */
  upgrade?: boolean;
};

/**
 * Controls where and how extracted files are written.
 */
export type OutputConfig = {
  /**
   * Output directory relative to cwd. Concatenated across recursion levels.
   * Defaults to '.' (current working directory) when omitted.
   */
  path?: string;
  /**
   * Overwrite existing unmanaged files. Overridden by --force and --keep-existing.
   */
  force?: boolean;
  /**
   * Skip files that already exist; create missing ones. Cannot combine with force.
   */
  keepExisting?: boolean;
  /**
   * Create/update .gitignore alongside each .npmdata marker.
   */
  gitignore?: boolean;
  /**
   * When set to false: write without .npmdata marker, no gitignore update, no read-only. Existing files skipped.
   * Takes precedence over force. Defaults to true (managed).
   */
  managed?: boolean;
  /**
   * Keep stale managed files on disk instead of deleting them during extract.
   * Check still reports them as extra drift until they are removed or synced.
   */
  noSync?: boolean;
  /**
   * Report what would change; no disk writes.
   */
  dryRun?: boolean;
  /**
   * Post-extract symlink operations. Appended across recursion levels.
   */
  symlinks?: SymlinkConfig[];
  /**
   * Post-extract content replacements. Appended across recursion levels.
   */
  contentReplacements?: ContentReplacementConfig[];
};

/**
 * Controls runtime output verbosity.
 */
export type ExecutionConfig = {
  /** Suppress per-file output; print only final summary line. */
  silent?: boolean;
  /** Print detailed step information. */
  verbose?: boolean;
};

/**
 * Defines one post-extract symlink operation.
 */
export type SymlinkConfig = {
  /** Glob relative to outputDir. Matching files/dirs get symlinked into `target`. */
  source: string;
  /** Directory where symlinks are created, relative to outputDir. Supports ../ paths. */
  target: string;
};

/**
 * Defines one post-extract content replacement operation.
 */
export type ContentReplacementConfig = {
  /** Glob relative to cwd selecting workspace files to modify. */
  files: string;
  /** Regex string; all non-overlapping occurrences replaced (global flag applied). */
  match: string;
  /** Replacement string; may contain back-references ($1, $2). */
  replace: string;
};

/**
 * One entry in the npmdata.sets array. Represents a single extraction target.
 *
 * Two variants:
 *  - Self-package entry  (no `package` field): leaf of recursion; files come from the
 *    package whose npmdata.sets contains this entry.
 *  - External-package entry (`package` field set): recurses into the named package's own
 *    npmdata.sets (or enumerates its files directly when it has no sets).
 */
export type NpmdataExtractEntry = {
  /**
   * Flat package spec string ("my-pkg@^1.2.3"). When absent the entry is a
   * self-package entry — files are drawn from the package that owns this sets array.
   */
  package?: string;
  /** Resolve package from npm, git, or auto-detect from the package spec. */
  source?: SourceKind;
  /** Where/how to write files. Defaults to current directory with no special flags. */
  output?: OutputConfig;
  /** Which files to select and install options. */
  selector?: SelectorConfig;
  /**
   * Preset tags for --presets CLI filtering. An entry is included when at least
   * one of its presets appears in the requested preset list.
   * Not forwarded to dependency packages.
   */
  presets?: string[];
  /** Suppress per-file output. Root-level (not nested). */
  silent?: boolean;
  /** Print detailed step information. Root-level (not nested). */
  verbose?: boolean;
};

/**
 * Top-level structure stored under npmdata key in package.json or in any cosmiconfig source.
 */
export type NpmdataConfig = {
  /** All extraction entries. */
  sets: NpmdataExtractEntry[];
  /**
   * Shell command run after successful extract (not during --dry-run).
   * Executed in process.cwd(). Full argv appended as arguments.
   */
  postExtractScript?: string;
};

/**
 * A single file operation in the diff/execute pipeline.
 */
export type FileOperation = {
  relPath: string;
  sourcePath: string;
  destPath: string;
  hash: string;
};

/**
 * A file skipped during extraction with the reason.
 */
export type SkippedFile = {
  relPath: string;
  reason: 'conflict' | 'keep-existing' | 'not-managed';
};

/**
 * A file in outputDir that is not tracked by npmdata and blocks extraction.
 */
export type ConflictFile = {
  relPath: string;
  /** Set when file is managed by a different package. */
  existingOwner?: string;
};

/**
 * Internal read-only structure produced by fileset/diff.ts. Not persisted.
 */
export type ExtractionMap = {
  /** Files present in package source but absent from outputDir. */
  toAdd: FileOperation[];
  /** Files whose hash differs between package source and outputDir. */
  toModify: FileOperation[];
  /** Relative paths of managed files no longer present in filtered package source. */
  toDelete: string[];
  /** Files skipped with reason. */
  toSkip: SkippedFile[];
  /** Files in outputDir not tracked by npmdata that block extraction. */
  conflicts: ConflictFile[];
};

/**
 * One row in a .npmdata CSV marker file.
 * Format: path|packageName|packageVersion — one row per file, no header.
 */
export type ManagedFileMetadata = {
  /** Relative path from marker file directory. */
  path: string;
  /** Source npm package name. */
  packageName: string;
  /** Installed version at extraction time. */
  packageVersion: string;
  /** Managed path type. Omitted in marker files for regular files. */
  kind?: 'file' | 'symlink';
};

/**
 * Event emitted by extract/check/purge for UI progress reporting.
 */
export type FileProgressEvent = {
  type: 'file-added' | 'file-modified' | 'file-deleted' | 'file-skipped';
  packageName: string;
  file: string;
  managed: boolean;
  gitignore: boolean;
};

export type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end'; packageName: string; packageVersion: string }
  | FileProgressEvent;

/**
 * Result of a check operation for a single fileset.
 */
export type CheckResult = {
  /** Files in .npmdata marker but absent from output dir. */
  missing: string[];
  /** Files whose content hash differs from package source. */
  modified: string[];
  /** Files in filtered package source but never extracted. */
  extra: string[];
};

/**
 * Result of purging one fileset.
 */
export type PurgeResult = {
  /** Number of files deleted. */
  deleted: number;
  /** Number of symlinks removed. */
  symlinksRemoved: number;
  /** Number of empty dirs removed. */
  dirsRemoved: number;
};

/**
 * Result of executing an ExtractionMap.
 */
export type ExecuteResult = {
  /** Paths of newly created files (for rollback purposes). */
  newlyCreated: string[];
  /** Number of files added. */
  added: number;
  /** Number of files modified. */
  modified: number;
  /** Number of files deleted. */
  deleted: number;
  /** Number of files skipped. */
  skipped: number;
};

/**
 * A single resolved file produced by resolveFiles().
 * Carries all metadata needed to apply disk changes without further config lookups.
 */
export type ResolvedFile = {
  /** Relative path within the output directory. */
  relPath: string;
  /** Absolute path of the source file in the installed package directory. */
  sourcePath: string;
  /** Name of the npm package that owns this file. */
  packageName: string;
  /** Installed version of the source package. */
  packageVersion: string;
  /** Absolute path of the output directory where the file should be written. */
  outputDir: string;
  /** Whether the file should be tracked in the .npmdata marker. Default: true. */
  managed: boolean;
  /** Whether the file should be added to .gitignore. Default: true. */
  gitignore: boolean;
  /** Whether to overwrite an existing unmanaged file. Default: false. */
  force: boolean;
  /** Whether to skip files that already exist in the output. Default: false. */
  ignoreIfExisting: boolean;
  /** Whether extract should leave stale managed files in place for this output. */
  noSync: boolean;
  /** Content replacement rules applied to this file before comparison. */
  contentReplacements: ContentReplacementConfig[];
  /** Symlink operations to apply in the output directory after extraction. */
  symlinks: SymlinkConfig[];
};

/** Classification of a single file in the calculateDiff result. */
export type DiffStatus = 'ok' | 'missing' | 'extra' | 'conflict';

/**
 * One entry in a DiffResult.
 * - ok: desired file exists, content and state match
 * - missing: desired file is absent from the output directory
 * - extra: managed file in the marker is not present in the desired file list
 * - conflict: desired file exists but content, managed state, or gitignore state differs
 */
export type DiffEntry = {
  status: DiffStatus;
  /** Relative path within the output directory. */
  relPath: string;
  /** Absolute path to the output directory. */
  outputDir: string;
  /** Desired file metadata (absent for 'extra' entries). */
  desired?: ResolvedFile;
  /** Existing marker entry (absent for 'missing' entries and unmanaged conflicts). */
  existing?: ManagedFileMetadata;
  /** Reasons for conflict (only set for 'conflict' status). */
  conflictReasons?: Array<'content' | 'managed' | 'gitignore'>;
};

/**
 * Aggregate result of calculateDiff().
 */
export type DiffResult = {
  /** Desired files that already match the output directory. */
  ok: DiffEntry[];
  /** Desired files absent from the output directory. */
  missing: DiffEntry[];
  /** Managed files in the marker that are not in the desired file list. */
  extra: DiffEntry[];
  /** Desired files with content, managed-state, or gitignore-state mismatch. */
  conflict: DiffEntry[];
};
