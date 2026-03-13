SHELL := /bin/bash

install:
	# copy local relative dependencies (required by local npmdata package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/npmdata-0.0.1.tgz ../lib/dist/

	pnpm add npmdata@file:../lib/dist/npmdata-0.0.1.tgz
	pnpm add example-files-package@file:../mypackage/dist/example-files-package-1.0.0.tgz
	pnpm install --no-frozen-lockfile

test: clean install
	# --- Test 1: split-set extraction from myconfig.json (no 'npmdata' key in package.json) ---
	# Set 1 extracts .configs/** and docs/** but EXCLUDES .configs/database.config.json
	# Set 2 extracts ONLY .configs/database.config.json as managed=false with keepExisting
	pnpm exec npmdata extract --config myconfig.json
	test -e output/.configs/app.config.json
	test -e output/docs/README.md
	test -e output/docs/adrs/adr-001-sample1.md
	# The separately-configured file is also extracted (from set 2)
	test -e output/.configs/database.config.json
	# eslint@8 conf/config-schema.js is extracted but managed=false (set 3)
	test -e output/conf/config-schema.js
	# temper with config-schema and because it's not managed, check should pass
	echo "custom local content" > output/conf/config-schema.js
	# check: all managed files should be in sync
	pnpm exec npmdata check --config myconfig.json

	# temper with managed file and check should fail
	chmod +w output/docs/adrs/adr-001-sample1.md
	echo "custom local content" > output/docs/adrs/adr-001-sample1.md
	! pnpm exec npmdata check --config myconfig.json

	# restore the file and check should pass again
	pnpm exec npmdata extract --config myconfig.json
	pnpm exec npmdata check --config myconfig.json

	# --- Test 2: keepExisting prevents overwriting a pre-existing file ---
	# Overwrite the managed=false file with custom content (it is not read-only, being managed=false)
	echo "custom local content" > output/.configs/database.config.json
	# Re-extract (without purge): Set 2 sees the file already exists and skips it
	pnpm exec npmdata extract --config myconfig.json
	# Custom content must be preserved — keepExisting skips extraction when file exists
	grep -q "custom local content" output/.configs/database.config.json

	# check: all managed files should be in sync (database.config.json is drifted, but is managed=false)
	pnpm exec npmdata check --config myconfig.json

	# --- Test 3: purge removes managed files but leaves the managed=false file behind ---
	pnpm exec npmdata purge --config myconfig.json --verbose
	# managed files are removed
	test ! -e output/.configs/app.config.json
	test ! -e output/docs/README.md
	test ! -e output/conf/globals.js
	# database.config.json is managed=false, so it survives purge
	test -e output/.configs/database.config.json
	# conf/config-schema.js is managed=false (set 3), so it also survives purge
	test -e output/conf/config-schema.js

	# check: all managed files should be in sync
	pnpm exec npmdata check --config myconfig.json

	@echo "All split-set config tests passed"

lint:
	pnpm exec npmdata check --config myconfig.json

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -f pnpm-lock.yaml
	@cp -f package.json.orig package.json
