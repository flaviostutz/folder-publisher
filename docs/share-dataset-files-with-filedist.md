# How To Share Dataset Files With filedist Using Plain Git Repositories

If you need the same dataset files in multiple projects, the usual options all have tradeoffs.

- Git submodules make consumers deal with repo plumbing.
- Copying files between repos breaks versioning discipline fast.
- Ad hoc download scripts usually drift, especially when different teams need different slices of the same dataset.

`filedist` gives you a cleaner option: keep the dataset in a plain git repository, describe what should be extracted in `.filedistrc`, and let consumer projects pull the files they need from tagged git refs.

That works well for:

- seed datasets for local development
- shared JSON fixtures used by multiple services
- ML evaluation datasets that should be versioned with application code
- reference data distributed to internal tools, CLIs, or docs sites

This version of the workflow is useful when you want the shared dataset source to feel less tied to Node.js. The source repository can just be files plus `.filedistrc`. No `package.json`, no npm publish step, no package-specific wrapper script.

## The mental model

There are still only two roles:

- **Source repo**: the git repository that owns the dataset files
- **Consumer repo**: the project that extracts those files locally

The source repo keeps the authoritative copy of the data. The consumer gets a local extracted copy plus a `.filedist` marker file that tracks ownership, so updates, checks, and purges stay safe and predictable.

## 1. Create a plain git repository for the dataset

Start with a normal repository containing the files you want to share.

```text
acme-users-dataset/
  .filedistrc
  data/
    users-dataset/
      user1.json
      user2.json
      labels.json
```

The key point is that this repo does not need to be an npm package. It can just be a git repo with versioned files.

## 2. Describe the shared files in .filedistrc

At the root of the dataset repository, define what filedist should expose.

```json
{
  "sets": [
    {
      "selector": {
        "files": ["data/**"]
      },
      "output": {
        "path": "."
      },
      "presets": ["full"]
    },
    {
      "selector": {
        "files": ["data/users-dataset/user2.json"]
      },
      "output": {
        "path": ".",
        "managed": false,
        "gitignore": false
      },
      "presets": ["sample"]
    }
  ]
}
```

Two details matter here:

- For the repo's own files, omit `package`. That means "extract from this repository itself".
- Use `presets` when consumers should be able to request only part of the dataset.

The second set shows a useful pattern when one dataset slice should be copied locally without filedist continuing to manage it afterwards.

## 3. Tag the repository instead of publishing a package

Once the dataset is ready, commit it and create a git tag:

```sh
git add .
git commit -m "Add initial users dataset"
git tag v1.0.0
git push origin main --tags
```

That tag becomes the version consumers reference. Instead of publishing to an npm registry, you just publish commits and tags to git.

## 4. Configure the consumer with .filedistrc

In the consumer project, declare the dataset source in its own `.filedistrc`.

```json
{
  "sets": [
    {
      "package": "git:github.com/acme/acme-users-dataset@v1.0.0",
      "selector": {
        "files": ["data/users-dataset/**"]
      },
      "output": {
        "path": "./vendor-data"
      },
      "presets": ["core"]
    }
  ]
}
```

This keeps the consumer configuration out of `package.json` too. If you are trying to keep data distribution decoupled from Node-specific project metadata, this is the cleaner shape.

You can also point to local repositories with `git:file://` URLs during development:

```json
{
  "sets": [
    {
      "package": "git:file:///absolute/path/to/acme-users-dataset@v1.0.0",
      "output": {
        "path": "./vendor-data"
      }
    }
  ]
}
```

On Windows, use the same format with a drive letter, for example `git:file:///C:/work/acme-users-dataset@v1.0.0`.

## 5. Extract, check, and purge from the consumer

Once the consumer has a `.filedistrc`, the workflow is simple:

```sh
npx filedist extract
npx filedist check
npx filedist purge
npx filedist presets
```

After extraction, the consumer ends up with normal files in its own tree:

```text
consumer-project/
  .filedistrc
  vendor-data/
    data/
      users-dataset/
        user1.json
        user2.json
        labels.json
    .filedist
```

That `.filedist` file is what lets filedist later answer two operational questions cleanly:

- "Are my extracted files still in sync with the tagged source repo?"
- "Which files should be removed if I stop using this dataset source?"

## 6. Update datasets by moving the git ref

When the source repo changes the dataset:

1. Update the files in the dataset repo.
2. Commit the change.
3. Create a new tag.
4. Change the consumer's `.filedistrc` to point to the new tag.
5. Run `extract` again.

For example, changing from `v1.0.0` to `v1.1.0` is just a config edit:

```json
{
  "sets": [
    {
      "package": "git:github.com/acme/acme-users-dataset@v1.1.0",
      "output": {
        "path": "./vendor-data"
      }
    }
  ]
}
```

Then run:

```sh
npx filedist extract
npx filedist check
```

Because the extracted files are tracked, the update is not a blind copy. filedist can tell you which files were added, modified, deleted, or skipped.

## 7. Decide upfront which files should be managed

For shared datasets, the default `managed: true` setting is usually right.

Use managed files when:

- the consumer should not hand-edit the extracted data
- you want `check` and `purge` to work reliably
- the source repository is the source of truth

Use `managed: false` only when:

- the consumer wants a bootstrap copy and will own changes afterwards
- a specific output should not become read-only or marker-tracked
- you deliberately want filedist to stop governing that file after extraction

If you are sharing canonical dataset files across repos, unmanaged extraction should be the exception, not the default.

## 8. Reuse the repository example that matches this approach

This repository already contains a concrete git-source example:

- `examples/git-sources-config` uses `.filedistrc` and `package.json` config discovery on the consumer side
- the source repositories in that example are plain local git repos with tagged refs and root `.filedistrc`

That example is the closest reference implementation for sharing files through git sources instead of npm packages.

## Why this approach works well

Using filedist with git repositories gives you a clean separation of concerns:

- dataset ownership stays in one repo
- consumers choose where extracted files live
- versions are explicit through git tags
- extraction is reproducible in CI and local development
- the source side can stay mostly tool-agnostic: files plus `.filedistrc`
- safety comes from the `.filedist` marker instead of shell-script conventions

If your team already collaborates through git and wants to avoid turning every shared dataset into a published npm package, this is usually the lowest-friction approach.

## Minimal workflow recap

Source repo:

```sh
git add .
git commit -m "Update users dataset"
git tag v1.0.0
git push origin main --tags
```

Consumer repo `.filedistrc`:

```json
{
  "sets": [
    {
      "package": "git:github.com/acme/acme-users-dataset@v1.0.0",
      "output": {
        "path": "./vendor-data"
      }
    }
  ]
}
```

Consumer commands:

```sh
npx filedist extract
npx filedist check
```

If your goal is "share dataset files from a plain git repository with versioning and safe local extraction", this is the filedist path that keeps the source side least dependent on Node.js conventions.