# Reddit Post

## Suggested title

I built an open source tool to version and distribute prompt packs, agent instructions, and shared repo assets from npm or git

## Body

I kept hitting the same problem while working across multiple repos: reusable prompts, agent rules, docs, and datasets were getting copied around manually.

So I built `npmdata`.

It lets you publish folders as npm packages or point directly to plain git repos, then extract selected files into a consumer repo.

Example:

```sh
npx npmdata extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

The interesting part for me is that it works for things that are not normal code dependencies but still need versioning and reuse:

- prompt packs
- agent instruction files
- eval datasets
- XDRs / ADRs
- shared config bundles

It also tracks managed outputs with a `.npmdata` marker so `check` and `purge` remain safe.

Repo:
https://github.com/flaviostutz/npmdata

I would like feedback from people already sharing these kinds of files across repos. What would you package first?