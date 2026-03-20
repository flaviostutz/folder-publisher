import { FileProgressEvent } from '../types';

/**
 * Render per-file progress labels with explicit managed and gitignore state.
 */
export function formatProgressFile(event: FileProgressEvent): string {
  const managedFlag = event.managed ? 'M' : 'U';
  const gitignoreFlag = event.gitignore ? 'I' : 'G';
  return `${event.file} (${managedFlag},${gitignoreFlag})`;
}
