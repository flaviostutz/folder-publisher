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
	@assert_symlink() { \
		link_path="$$1"; \
		expected_path="$$2"; \
		test -L "$$link_path"; \
		actual_link_target="$$(cd "$$(dirname "$$link_path")" && pwd -P)/$$(readlink "$$link_path")"; \
		actual_path="$$(cd "$$(dirname "$$actual_link_target")" && pwd -P)/$$(basename "$$actual_link_target")"; \
		resolved_expected_path="$$(cd "$$(dirname "$$expected_path")" && pwd -P)/$$(basename "$$expected_path")"; \
		test "$$actual_path" = "$$resolved_expected_path"; \
	}; \
	assert_symlink output/data-symlink/users-dataset output/data/users-dataset; \
	assert_symlink output/data-symlink/user1.json output/data/users-dataset/user1.json
	test ! -e output/eslint/conf/globals.js
	test -e output/lastUpdated

	# check without --packages: reads entries from package.json
	pnpm exec filedist check

	# check detects symlink drift and extract repairs it
	@retarget_symlink() { \
		link_path="$$1"; \
		target_path="$$2"; \
		rm -f "$$link_path"; \
		ln -s "$$(cd "$$(dirname "$$target_path")" && pwd -P)/$$(basename "$$target_path")" "$$link_path"; \
	}; \
	retarget_symlink output/data-symlink/user1.json output/docs/README.md
	! pnpm exec filedist check
	pnpm exec filedist extract
	@assert_symlink() { \
		link_path="$$1"; \
		expected_path="$$2"; \
		test -L "$$link_path"; \
		actual_link_target="$$(cd "$$(dirname "$$link_path")" && pwd -P)/$$(readlink "$$link_path")"; \
		actual_path="$$(cd "$$(dirname "$$actual_link_target")" && pwd -P)/$$(basename "$$actual_link_target")"; \
		resolved_expected_path="$$(cd "$$(dirname "$$expected_path")" && pwd -P)/$$(basename "$$expected_path")"; \
		test "$$actual_path" = "$$resolved_expected_path"; \
	}; \
	assert_symlink output/data-symlink/user1.json output/data/users-dataset/user1.json

	# purge without --packages: reads entries from package.json
	pnpm exec filedist purge
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
	test ! -e output/data-symlink/user1.json
	test ! -e output/data-symlink/users-dataset
	test -e output/lastUpdated

	# --- Test 2: config from .filedistrc ---
	# temporarily move the "filedist" field out of package.json and write .filedistrc
	jq '.filedist' package.json > .filedistrc
	jq 'del(.filedist)' package.json > package.json.tmp && mv package.json.tmp package.json

	pnpm exec filedist extract
	test -e output/docs/README.md
	test -e output/data/users-dataset/user1.json
	@assert_symlink() { \
		link_path="$$1"; \
		expected_path="$$2"; \
		test -L "$$link_path"; \
		actual_link_target="$$(cd "$$(dirname "$$link_path")" && pwd -P)/$$(readlink "$$link_path")"; \
		actual_path="$$(cd "$$(dirname "$$actual_link_target")" && pwd -P)/$$(basename "$$actual_link_target")"; \
		resolved_expected_path="$$(cd "$$(dirname "$$expected_path")" && pwd -P)/$$(basename "$$expected_path")"; \
		test "$$actual_path" = "$$resolved_expected_path"; \
	}; \
	assert_symlink output/data-symlink/users-dataset output/data/users-dataset; \
	assert_symlink output/data-symlink/user1.json output/data/users-dataset/user1.json
	test ! -e output/eslint/conf/globals.js
	test -e output/lastUpdated

	pnpm exec filedist check
	test -e output/docs/README.md
	pnpm exec filedist purge
	test ! -e output/docs/README.md
	test ! -e output/data-symlink/user1.json
	test ! -e output/data-symlink/users-dataset
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

	# --- Test 5: --all ignores defaultPresets and processes every configured entry ---
	rm -rf output
	pnpm exec filedist extract --all
	test -e output/docs/README.md
	test -e output/data/users-dataset/user1.json
	@assert_symlink() { \
		link_path="$$1"; \
		expected_path="$$2"; \
		test -L "$$link_path"; \
		actual_link_target="$$(cd "$$(dirname "$$link_path")" && pwd -P)/$$(readlink "$$link_path")"; \
		actual_path="$$(cd "$$(dirname "$$actual_link_target")" && pwd -P)/$$(basename "$$actual_link_target")"; \
		resolved_expected_path="$$(cd "$$(dirname "$$expected_path")" && pwd -P)/$$(basename "$$expected_path")"; \
		test "$$actual_path" = "$$resolved_expected_path"; \
	}; \
	assert_symlink output/data-symlink/users-dataset output/data/users-dataset; \
	assert_symlink output/data-symlink/user1.json output/data/users-dataset/user1.json
	test -e output/eslint/conf/globals.js
	test -e output/nested-eslint/conf/globals.js
	pnpm exec filedist check --all
	pnpm exec filedist purge --all
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
	test ! -e output/data-symlink/user1.json
	test ! -e output/data-symlink/users-dataset
	test ! -e output/nested-eslint/conf/globals.js

	@echo "All config-file mode tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -f pnpm-lock.yaml
	@rm -f .filedistrc
	@cp -f package.json.orig package.json
