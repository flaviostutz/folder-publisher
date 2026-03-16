install:
	# copy local relative dependencies (required by local npmdata package)
	mkdir -p ../lib/dist
	cp -R ../../lib/dist/npmdata-0.0.1.tgz ../lib/dist/

	pnpm add example-files-package@file:../mypackage/dist/example-files-package-1.0.0.tgz
	pnpm install

build: install
# 	pnpm exec example-files-package
# 	pnpm exec example-files-package extract --files "docs/**/*,conf/**/*" --output output

test: clean install
	@echo ""
	@echo ">>>> mypackage-consumer"

	# Test 1
	rm -rf output
	pnpm exec example-files-package extract --output output
	test -e output/.configs/app.config.json
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js

	pnpm exec example-files-package check --output output

	pnpm exec example-files-package list --output output

	pnpm exec example-files-package purge --output output
	test ! -e output/.configs/app.config.json
	test ! -e output/docs/adrs/adr-001-sample1.md

	# Test 2 - basic preset
	rm -rf output
	pnpm exec example-files-package extract --output output --presets basic
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js
	test ! -e output/conf/config-schema.js

	# Test 3 - eslint preset
	rm -rf output
	pnpm exec example-files-package extract --output output --presets eslint
	test ! -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js
	test -e output/conf/config-schema.js

	# Test 4
	rm -rf output
	pnpm exec example-files-package extract --output output --presets "eslint,basic"
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js
	test -e output/conf/config-schema.js


clean:
	@rm -rf node_modules
	@rm -rf output
