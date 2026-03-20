// Public library exports for npmdata v2

export { actionExtract } from './package/action-extract';
export type { ExtractOptions, ExtractResult } from './package/action-extract';

export { actionCheck } from './package/action-check';
export type { CheckOptions, CheckSummary } from './package/action-check';

export { actionList } from './package/action-list';
export type { ListOptions } from './package/action-list';

export { actionPurge } from './package/action-purge';
export type { PurgeOptions, PurgeSummary } from './package/action-purge';

export { resolveFiles } from './package/resolve-files';
export type { ResolveOptions } from './package/resolve-files';

export { calculateDiff } from './package/calculate-diff';

export { binpkg } from './cli/binpkg';

export type {
  NpmdataConfig,
  NpmdataExtractEntry,
  PackageConfig,
  SelectorConfig,
  OutputConfig,
  SymlinkConfig,
  ContentReplacementConfig,
  ManagedFileMetadata,
  ProgressEvent,
  ExtractionMap,
  CheckResult,
  PurgeResult,
  ExecuteResult,
  ResolvedFile,
  DiffStatus,
  DiffEntry,
  DiffResult,
} from './types';
