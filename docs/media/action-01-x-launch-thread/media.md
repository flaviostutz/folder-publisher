# X Launch Thread

Post 1

AI coding teams have a weird distribution problem:

- prompts live in one repo
- agent instructions in another
- eval datasets somewhere else
- every consumer repo ends up copying files by hand

I built `npmdata` to fix that.

https://github.com/flaviostutz/npmdata

Post 2

`npmdata` lets you publish folders from npm packages or plain git repos and extract them into any workspace.

That means you can version and reuse:

- prompt packs
- agent kits
- XDRs / ADRs
- eval datasets
- shared config

Post 3

Example:

```sh
npx npmdata extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

Same idea works for prompt repos, internal agent rules, and curated data bundles.

Post 4

The part I wanted most:

- no git submodules
- no copy-paste drift
- no custom sync script
- safe updates with `check` and `purge`

Managed files get a `.npmdata` marker so updates stay predictable.

Post 5

I think the sharpest use case is AI coding teams sharing:

- prompt libraries
- `AGENTS.md` packs
- agent-specific rules
- evaluation fixtures
- reusable docs

from npm or git, with versioned refs.

Post 6

If that sounds useful, take a look at the examples and star the repo so I know this direction is worth pushing.

https://github.com/flaviostutz/npmdata