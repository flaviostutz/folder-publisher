import path from 'node:path';

import { SelectorConfig, OutputConfig } from '../types';

/**
 * Merge two SelectorConfig objects across recursion levels.
 * - files: ANDed (intersection); when either is absent, use the other's list
 * - exclude: concatenated (both exclusion lists apply)
 * - contentRegexes: ANDed (both must match)
 * - presets: NOT inherited (caller's presets not forwarded to dependency)
 * - upgrade: each level evaluated independently (not merged)
 */
export function mergeSelectorConfig(parent: SelectorConfig, child: SelectorConfig): SelectorConfig {
  const parentGroups = parent.filePatternGroups ?? (parent.files ? [parent.files] : []);
  const childGroups = child.filePatternGroups ?? (child.files ? [child.files] : []);
  const filePatternGroups = [...parentGroups, ...childGroups];
  const files =
    filePatternGroups.length > 0
      ? [...new Set(filePatternGroups.flat())]
      : (parent.files ?? child.files);

  const contentRegexes =
    parent.contentRegexes && child.contentRegexes
      ? [...parent.contentRegexes, ...child.contentRegexes]
      : (parent.contentRegexes ?? child.contentRegexes);

  const exclude = [...(parent.exclude ?? []), ...(child.exclude ?? [])];

  return {
    files,
    ...(filePatternGroups.length > 0 ? { filePatternGroups } : {}),
    exclude,
    contentRegexes,
    presets: child.presets, // not inherited from parent
    upgrade: child.upgrade, // each level independent
  };
}

/**
 * Merge two OutputConfig objects for recursive extraction.
 * - force, keepExisting, gitignore, managed, dryRun: caller value overrides child
 * - path: concatenated (parent/child), undefined treated as '.'
 * - symlinks: appended (parent + child)
 * - contentReplacements: appended (parent + child)
 */
export function mergeOutputConfig(caller: OutputConfig, child: OutputConfig): OutputConfig {
  const callerPath = caller.path ?? '.';
  const childPath = child.path ?? '.';
  // When childPath is absolute it overrides the inherited path entirely.
  // path.join('.', '/absolute') would strip the leading slash, so we check explicitly.
  const mergedPath = path.isAbsolute(childPath) ? childPath : path.join(callerPath, childPath);
  return {
    path: mergedPath,
    force: caller.force ?? child.force,
    keepExisting: caller.keepExisting ?? child.keepExisting,
    gitignore: caller.gitignore ?? child.gitignore,
    managed: caller.managed ?? child.managed,
    dryRun: caller.dryRun ?? child.dryRun,
    symlinks: [...(caller.symlinks ?? []), ...(child.symlinks ?? [])],
    contentReplacements: [
      ...(caller.contentReplacements ?? []),
      ...(child.contentReplacements ?? []),
    ],
  };
}
