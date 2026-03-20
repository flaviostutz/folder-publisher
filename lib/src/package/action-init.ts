/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { detect } from 'package-manager-detector/detect';
import { resolveCommand } from 'package-manager-detector/commands';

import { NpmdataExtractEntry } from '../types';

export type InitConfig = {
  /** File glob patterns to include in the package and use as selector for filesets. */
  files?: string[];
  /** External package specs (e.g. "eslint@8") to add as npmdata sets and dependencies. */
  packages?: string[];
};

/**
 * Scaffold or update a publishable npm data package.
 * If package.json already exists, updates it in place.
 * Creates bin/npmdata.js if it does not already exist.
 */
export async function actionInit(
  outputDir: string,
  verbose: boolean,
  config?: InitConfig,
): Promise<void> {
  const pkgJsonPath = path.join(outputDir, 'package.json');
  const binDir = path.join(outputDir, 'bin');
  const binPath = path.join(binDir, 'npmdata.js');

  const binShim = `#!/usr/bin/env node\n'use strict';\nrequire('npmdata').binpkg(__dirname, process.argv.slice(2));\n`;

  fs.mkdirSync(outputDir, { recursive: true });

  // Read existing package.json or create a new skeleton
  let pkgJson: Record<string, unknown>;
  if (fs.existsSync(pkgJsonPath)) {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath).toString()) as Record<string, unknown>;
  } else {
    const dirName = path.basename(outputDir);
    pkgJson = {
      name: dirName,
      version: '1.0.0',
      description: '',
      dependencies: {},
    };
  }

  const filePatterns = config?.files ?? [];
  const externalPackages = config?.packages ?? [];

  // Set bin entry
  pkgJson.bin = 'bin/npmdata.js';

  // Update npm files list to include data patterns and the bin shim
  const npmFiles = new Set<string>([...filePatterns, 'package.json', 'bin/npmdata.js']);
  pkgJson.files = Array.from(npmFiles);

  // Build npmdata sets: self entry first (no package field), then external packages
  const selfEntry: NpmdataExtractEntry = {
    output: { path: '.' },
    ...(filePatterns.length > 0 ? { selector: { files: filePatterns } } : {}),
  };
  const externalEntries: NpmdataExtractEntry[] = externalPackages.map((pkg) => ({
    package: pkg,
    output: { path: '.' },
    ...(filePatterns.length > 0 ? { selector: { files: filePatterns } } : {}),
  }));
  pkgJson.npmdata = { sets: [selfEntry, ...externalEntries] };

  // Write updated package.json (dependencies are managed by the `add` command below)
  // eslint-disable-next-line unicorn/no-null
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8');

  // Create bin/npmdata.js only if it does not already exist
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(binPath, binShim, 'utf8');
    fs.chmodSync(binPath, 0o755);
  }

  // Add npmdata + any external packages via the package manager so the lockfile
  // and package.json dependencies are updated with the correct resolved versions.
  const detected = await detect({ cwd: outputDir });
  const agent = detected?.agent ?? 'npm';
  const packagesToAdd = ['npmdata', ...externalPackages];
  const addResolved = resolveCommand(agent, 'add', packagesToAdd);
  if (addResolved) {
    const cmd = `${addResolved.command} ${addResolved.args.join(' ')}`;
    if (verbose) {
      console.log(`Running: ${cmd}`);
    }
    execSync(cmd, { cwd: outputDir, stdio: 'pipe' });
  }

  if (verbose) {
    console.log(`Updated: ${pkgJsonPath}`);
    console.log(`Created: ${binPath}`);
  }
}
