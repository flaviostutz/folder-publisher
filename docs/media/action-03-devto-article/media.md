# Dev.to Article Draft

## Title

How I distribute prompt packs, agent instructions, and shared repo assets with npmdata

## Tags

`opensource` `ai` `productivity` `javascript`

## Body

If you are building with AI coding agents, you eventually end up with a pile of reusable assets that do not belong in every repository by default:

- prompt libraries
- `AGENTS.md` and instruction packs
- evaluation datasets
- internal XDRs or operating guides
- shared configuration files

The naive ways to share them all get painful quickly.

- Copying files between repos creates drift.
- Git submodules add workflow overhead to every consumer.
- Custom sync scripts tend to become unmaintained glue.

I wanted something simpler: version those assets once, keep them in npm or plain git, and let consumer projects extract exactly what they need.

That is why I built `npmdata`.

## What npmdata does

`npmdata` publishes folders as reusable packages or reads them from plain git repositories, then extracts selected files into any workspace.

It supports three patterns:

1. Ad-hoc extraction from a package or git repo
2. Consumer-side config with `.npmdatarc` or `package.json`
3. Curated packages that bundle many upstream sources into one reusable distribution

Here is the simplest example:

```sh
npx npmdata extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

That pulls versioned files from a git repository into a local folder.

## Why this fits AI coding teams well

AI coding workflows often need the same supporting files in many repositories:

- system prompts
- coding rules
- evaluation fixtures
- internal documentation
- prompt-engineering templates

Those files behave more like versioned dependencies than ad-hoc docs.

With `npmdata`, you can keep them in one source repo and distribute them with explicit refs. Consumers can then:

- run `extract` to install them locally
- run `check` to see if their copy drifted
- run `purge` to remove managed files cleanly

Managed outputs include a `.npmdata` marker file so ownership stays explicit.

## A useful mental model

- Publisher: the repo or package that owns the files
- Consumer: the repo that extracts those files locally

That separation is what makes the workflow predictable.

## Where I think this is strongest today

The best near-term fit seems to be teams sharing:

- prompt packs
- agent kits
- XDR bundles
- datasets used for AI evaluations
- reusable setup/config files

If you are doing that today with copy-paste or submodules, `npmdata` is worth a look.

Repo and examples:

https://github.com/flaviostutz/npmdata

If you try it, star the repo and tell me which asset type you want to package first.