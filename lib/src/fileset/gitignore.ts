import fs from 'node:fs';
import path from 'node:path';

import { MARKER_FILE, GITIGNORE_FILE, GITIGNORE_START, GITIGNORE_END } from './constants';

/**
 * Add paths to the npmdata-managed section in .gitignore.
 * Creates the file if it does not exist.
 * Always includes the MARKER_FILE itself in the managed section.
 */
export async function addToGitignore(markerDir: string, paths: string[]): Promise<void> {
  updateGitignoreSection(markerDir, paths, true);
}

/**
 * Read the paths currently listed in the npmdata-managed section.
 */
export function readManagedGitignoreEntries(markerDir: string): Set<string> {
  const gitignorePath = path.join(markerDir, GITIGNORE_FILE);
  if (!fs.existsSync(gitignorePath)) return new Set();

  const existingContent = fs.readFileSync(gitignorePath, 'utf8');
  const { managedEntries } = parseSections(existingContent);
  return new Set(managedEntries);
}

/**
 * Remove specific paths from the npmdata-managed section in .gitignore.
 * Removes the entire section if no paths remain. Deletes the file if empty.
 */
export async function removeFromGitignore(markerDir: string, paths: string[]): Promise<void> {
  const gitignorePath = path.join(markerDir, GITIGNORE_FILE);
  if (!fs.existsSync(gitignorePath)) return;

  const existingContent = fs.readFileSync(gitignorePath, 'utf8');
  const { beforeSection, managedEntries, afterSection } = parseSections(existingContent);

  // Remove specified paths from the managed section
  const pathSet = new Set(paths);
  const remaining = managedEntries.filter((e) => !pathSet.has(e) && e !== MARKER_FILE);

  writeGitignore(gitignorePath, beforeSection, remaining, afterSection);
}

/**
 * Replace the entire npmdata-managed gitignore section with a new set of paths.
 */
export function updateGitignoreSection(
  markerDir: string,
  managedPaths: string[],
  createIfMissing: boolean,
): void {
  const gitignorePath = path.join(markerDir, GITIGNORE_FILE);

  let existingContent = '';
  if (fs.existsSync(gitignorePath)) {
    existingContent = fs.readFileSync(gitignorePath, 'utf8');
  }

  const { beforeSection, afterSection, hasSection } = parseSections(existingContent);

  if (!createIfMissing && !hasSection) return;

  writeGitignore(gitignorePath, beforeSection, managedPaths, afterSection);
}

function parseSections(content: string): {
  beforeSection: string;
  managedEntries: string[];
  afterSection: string;
  hasSection: boolean;
} {
  const startIdx = content.indexOf(GITIGNORE_START);
  const endIdx = content.indexOf(GITIGNORE_END);
  const hasSection = startIdx !== -1 && endIdx !== -1 && startIdx < endIdx;

  if (!hasSection) {
    return { beforeSection: content, managedEntries: [], afterSection: '', hasSection: false };
  }

  const beforeSection = content.slice(0, startIdx).trimEnd();
  const sectionContent = content.slice(startIdx + GITIGNORE_START.length, endIdx);
  const managedEntries = sectionContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== MARKER_FILE);
  const afterSection = content.slice(endIdx + GITIGNORE_END.length).trimStart();

  return { beforeSection, managedEntries, afterSection, hasSection: true };
}

function writeGitignore(
  gitignorePath: string,
  beforeSection: string,
  managedPaths: string[],
  afterSection: string,
): void {
  if (managedPaths.length === 0) {
    // Remove the managed section entirely
    const updatedContent = [beforeSection, afterSection].filter(Boolean).join('\n');
    if (updatedContent.trim()) {
      fs.writeFileSync(gitignorePath, `${updatedContent.trimEnd()}\n`, 'utf8');
    } else if (fs.existsSync(gitignorePath)) {
      fs.unlinkSync(gitignorePath);
    }
    return;
  }

  const section = [GITIGNORE_START, MARKER_FILE, ...managedPaths.sort(), GITIGNORE_END].join('\n');
  const parts = [beforeSection, section, afterSection].filter(Boolean);
  const updatedContent = `${parts.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, updatedContent, 'utf8');
}
