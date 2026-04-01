# example-files-package

This is an example **publisher** project. It packages shared `docs/` and `data/` folders as an npm package using `filedist`, so any consumer project can install and extract those files locally.

The `mypackage-consumer/` sub-directory is an example **consumer** that installs this package and extracts its files.

## Directory layout

```
docs/          shared documentation and ADRs published with this package
data/          shared datasets published with this package
bin/filedist.js generated entry point script (created by `filedist init`)
```

## How to set up a publisher package from scratch

Run `filedist init` once to configure `package.json` so that the right folders are included on publish:

```sh
pnpm dlx filedist init --files "docs/**,data/**"
```

This updates `package.json` with:
- `files` — globs that include the shared folders in the tarball
- `bin` — a thin `bin/filedist.js` script consumers can call directly
- `dependencies` — pins the `filedist` runtime needed by that script

When you declare the package's own files in `package.json#filedist.sets`, the self entry should omit `package`. External dependency entries keep the `package` field.

Then publish as any normal npm package:

```sh
npm publish
```

## Running the example locally

The `Makefile` automates the full publisher + consumer cycle against the local `filedist` build:

These `make` targets are maintainer integration workflows and require a bash-compatible environment such as macOS, Linux, or WSL/Git Bash on Windows.

```sh
# build this package into a local tarball and run the consumer integration test
make test
```

`make test` performs:
1. Cleans previous build artefacts
2. Re-initialises the publisher configuration (`filedist init`)
3. Packs the package into `dist/`
4. Switches to `mypackage-consumer/` and runs its own `make test`

## Consumer side

See [`../mypackage-consumer/README.md`](../mypackage-consumer/README.md) for how a consumer installs and extracts files from this package.
