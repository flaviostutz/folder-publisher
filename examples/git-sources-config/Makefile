SHELL := /bin/bash

PARENT_TAG := v2.0.0
CHILD_TAG := v1.0.0

install:
	# copy local relative dependencies (required by local npmdata package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/npmdata-0.0.1.tgz ../lib/dist/

	pnpm add npmdata@file:../lib/dist/npmdata-0.0.1.tgz
	pnpm install --no-frozen-lockfile

prepare-config:
	PARENT_REPO_URL="file://$$(pwd)/repos/parent-repo"; \
	jq --arg parentRepo "$$PARENT_REPO_URL" '.npmdata.sets[0].package = ($$parentRepo + "@$(PARENT_TAG)")' package.json.orig > package.json

prepare-repos:
	rm -rf repos
	mkdir -p repos/child-repo/child
	mkdir -p repos/parent-repo/docs
	printf '{"ok":true}\n' > repos/child-repo/child/data.json
	CHILD_REPO_URL="file://$$(pwd)/repos/child-repo"; \
	jq -n --arg childRepo "$$CHILD_REPO_URL" --arg childTag "$(CHILD_TAG)" '{sets:[{output:{path:".",gitignore:false}},{package:($$childRepo + "@" + $$childTag),source:"git",output:{path:"nested",gitignore:false}}]}' > repos/parent-repo/.npmdatarc
	printf '# Parent Guide\n' > repos/parent-repo/docs/guide.md
	git -C repos/child-repo init
	git -C repos/child-repo config user.email 'npmdata@example.com'
	git -C repos/child-repo config user.name 'npmdata tests'
	git -C repos/child-repo add .
	git -C repos/child-repo commit -m 'child fixture'
	git -C repos/child-repo tag $(CHILD_TAG)
	git -C repos/parent-repo init
	git -C repos/parent-repo config user.email 'npmdata@example.com'
	git -C repos/parent-repo config user.name 'npmdata tests'
	git -C repos/parent-repo add .
	git -C repos/parent-repo commit -m 'parent fixture'
	git -C repos/parent-repo tag $(PARENT_TAG)

test: clean install prepare-repos
	@echo ""
	@echo ">>>> git-sources-config"

	# --- Test 1: config from package.json "npmdata" key ---
	make prepare-config
	pnpm exec npmdata extract
	test -e output/docs/guide.md
	test -e output/nested/child/data.json
	test -e output/.npmdata
	test -e output/nested/.npmdata
	test ! -e output/.git
	test ! -e output/.npmdatarc
	test ! -e output/nested/.git
	test ! -e output/nested/.npmdatarc
	grep -F "file://$$(pwd)/repos/parent-repo" output/.npmdata
	grep -F "file://$$(pwd)/repos/child-repo" output/nested/.npmdata
	test ! -e .npmdata-tmp
	grep -Fx ".npmdata-tmp" .gitignore
	pnpm exec npmdata check
	pnpm exec npmdata purge
	test ! -e output/docs/guide.md
	test ! -e output/nested/child/data.json
	test ! -e .npmdata-tmp

	# --- Test 2: config from .npmdatarc ---
	make prepare-config
	jq '.npmdata' package.json > .npmdatarc
	jq 'del(.npmdata)' package.json > package.json.tmp && mv package.json.tmp package.json
	pnpm exec npmdata extract
	test -e output/docs/guide.md
	test -e output/nested/child/data.json
	test -e output/.npmdata
	test -e output/nested/.npmdata
	test ! -e output/.git
	test ! -e output/.npmdatarc
	test ! -e output/nested/.git
	test ! -e output/nested/.npmdatarc
	pnpm exec npmdata check
	pnpm exec npmdata purge
	test ! -e output/docs/guide.md
	test ! -e output/nested/child/data.json

	# restore original package.json
	cp package.json.orig package.json
	rm -f .npmdatarc

	@echo "All git source config tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -rf repos
	@rm -rf .npmdata-tmp
	@rm -f pnpm-lock.yaml
	@rm -f .npmdatarc
	@cp -f package.json.orig package.json