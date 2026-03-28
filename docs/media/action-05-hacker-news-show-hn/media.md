# Hacker News Show HN Submission

## Title

Show HN: npmdata, version and distribute prompts, agent kits, docs, and datasets from npm or git

## Body

I built `npmdata` after repeatedly running into the same problem: some project assets need versioning and reuse across repositories, but they do not fit normal code dependency workflows.

Examples: prompt packs, agent instructions, XDRs, docs, evaluation datasets, and shared config files.

`npmdata` lets you publish folders as npm packages or plain git repositories and extract selected files into any workspace.

A simple example:

```sh
npx npmdata extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

Managed files are tracked with a `.npmdata` marker so updates and purges stay safe.

Repo:
https://github.com/flaviostutz/npmdata

I would especially like feedback from teams sharing prompts, agent kits, or evaluation data across many repos.

## First Comment Draft

One reason I think this is timely: AI coding teams are starting to treat prompts, instructions, and evaluation fixtures as reusable dependencies, but the tooling around distributing those assets is still clumsy. If you already have a workflow here, I would like to compare notes.