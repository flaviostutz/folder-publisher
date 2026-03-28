# git-sources-config

This example exercises `npmdata` in config-file mode when the source package is a git repository.
It creates a local tagged parent repository, configures that repository to recursively extract a tagged
child repository via `.npmdatarc`, and then validates the flow with both configuration sources that the
CLI auto-discovers:

- `package.json` → `npmdata` key
- `.npmdatarc`

## What it verifies

- git package specs are resolved from a local `file://` repository URL
- nested `.npmdatarc` inside a cloned git repository is loaded recursively
- extracted files land in separate output roots with separate `.npmdata` markers
- git metadata and `.npmdatarc` files are not copied into the output
- `check` and `purge` work without passing `--packages`

## Running the integration test

```bash
make test
```

The Makefile generates fresh local git repositories under `repos/`, tags them, patches `package.json`
with the correct absolute `file://` URL for the parent repository, and then runs the same extraction
cycle once from `package.json` config and once from `.npmdatarc` config.