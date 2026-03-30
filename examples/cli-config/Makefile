SHELL := /bin/bash

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm install --no-frozen-lockfile

test: clean install
	@echo ""
	@echo ">>>> cli-config"

	# --- Test 1: config from package.json "filedist" key ---
	# extract without --packages: reads entries from the "filedist" key in package.json
	# and applies filedist.defaultPresets=["basic"]
	pnpm exec filedist extract
	test -e output/docs/README.md
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/data/users-dataset/user1.json
	test ! -e output/eslint/conf/globals.js
	test -e output/lastUpdated

	# check without --packages: reads entries from package.json
	pnpm exec filedist check

	# purge without --packages: reads entries from package.json
	pnpm exec filedist purge
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
	test -e output/lastUpdated

	# --- Test 2: config from .filedistrc ---
	# temporarily move the "filedist" field out of package.json and write .filedistrc
	jq '.filedist' package.json > .filedistrc
	jq 'del(.filedist)' package.json > package.json.tmp && mv package.json.tmp package.json

	pnpm exec filedist extract
	test -e output/docs/README.md
	test -e output/data/users-dataset/user1.json
	test ! -e output/eslint/conf/globals.js
	test -e output/lastUpdated

	pnpm exec filedist check
	test -e output/docs/README.md
	pnpm exec filedist purge
	test ! -e output/docs/README.md
	test -e output/lastUpdated

	# restore original package.json
	cp package.json.orig package.json
	rm .filedistrc

	# --- Test 3: explicit --presets overrides defaultPresets ---
	rm -rf output
	pnpm exec filedist extract --presets "nested-eslint"
	test -e output/nested-eslint/conf/globals.js
	test ! -e output/docs/adrs/adr-001-sample1.md
	test ! -e output/data/users-dataset/user1.json
	test -e output/lastUpdated
	pnpm exec filedist check --presets "nested-eslint"
	pnpm exec filedist purge --presets "nested-eslint"
	test ! -e output/nested-eslint/conf/globals.js

	# --- Test 4: presets command lists all preset tags ---
	pnpm exec filedist presets | grep -x "basic"
	pnpm exec filedist presets | grep -x "extra"
	pnpm exec filedist presets | grep -x "nested-eslint"

	@echo "All config-file mode tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -f pnpm-lock.yaml
	@rm -f .filedistrc
	@cp -f package.json.orig package.json
