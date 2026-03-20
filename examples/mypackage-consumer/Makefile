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
	test -e output/conf/config-schema.js

	# user1 should be managed and in .gitignore
	test -e output/data/users-dataset/user1.json
	grep -e "data/users-dataset/user1.json" output/.gitignore
	grep -e "data/users-dataset/user1.json" output/.npmdata

	# user2 should be unmanaged and not in .gitignore
	test -e output/data/users-dataset/user2.json
	! grep -e "data/users-dataset/user2.json" output/.npmdata
	! grep -e "data/users-dataset/user2.json" output/.gitignore

	# user3 was excluded, so it should not be extracted at all
	test ! -e output/data/users-dataset/user3.json

	! grep -e "conf/config-schema.js" output/.npmdata

	pnpm exec example-files-package check --output output

	pnpm exec example-files-package list --output output

	pnpm exec example-files-package purge --output output
	test ! -e output/.configs/app.config.json
	test ! -e output/docs/adrs/adr-001-sample1.md

	# unmanaged files survive purge because they are not tracked in .npmdata
	test $$(find output -type f | wc -l) -eq 2
	test -e output/data/users-dataset/user2.json
	test -e output/conf/config-schema.js

	# Test 2 - basic preset
	pnpm exec example-files-package extract --output output --presets basic
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/data/users-dataset/user1.json
	# user2 is not in the basic preset, but it remains because it is unmanaged
	test -e output/data/users-dataset/user2.json
	test ! -e output/data/users-dataset/user3.json
	test -e output/conf/globals.js
	# config-schema.js is not included in basic preset, but it exists from previous and and in unmanaged, so it should be untouched
	test -e output/conf/config-schema.js

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
