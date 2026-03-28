SHELL := /bin/bash

%:
	@echo "Unknown target: $@. Ignoring"

init-publisher: install
	# package.json already contains the full npmdata configuration (no init step needed)
	# create the bin shim that allows consumers to run `npx example-files-package`
	mkdir -p bin
	printf '#!/usr/bin/env node\n'"'"'use strict'"'"';\nrequire('"'"'npmdata'"'"').binpkg(__dirname, process.argv.slice(2));\n' > bin/npmdata.js
	chmod +x bin/npmdata.js

build: install
	rm -rf dist
	pnpm pack --pack-destination dist

build-dev:
	cd ../../lib; make build; cd ../examples/mypackage; make init-publisher; make build; cd ../mypackage-consumer; make test

clean:
	@rm -rf node_modules
	@rm -rf dist
	@rm -rf lib
	@rm -rf bin
	make clean -C ../mypackage-consumer
	make clean -C ../cli-config
	make clean -C ../git-sources-config
	make clean -C ../split-set-config

test:
	echo "Running integration tests..."
	# prepare a deployable package from the pre-configured package.json
	make clean
	make init-publisher
	make build

	cd ../mypackage-consumer && make test
	cd ../cli-config && make test
	cd ../git-sources-config && make test
	cd ../split-set-config && make test

install:
	# replace the dependency with the local package
	pnpm add npmdata@file:../../lib/dist/npmdata-0.0.1.tgz
	@# update local tar gz checksum
	pnpm install

all: build test
