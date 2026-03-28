# LinkedIn Founder Post

Most AI coding workflows still share prompts, agent instructions, eval datasets, and internal templates the same old way: copy files between repos and hope they stay in sync.

That breaks fast.

I built `npmdata` to make those assets versioned and reusable from either npm packages or plain git repositories.

What it does:

- publish folders as reusable packages or git-source bundles
- extract only the files a consumer repo needs
- track ownership with a `.npmdata` marker so updates, checks, and purges stay safe

Example:

```sh
npx npmdata extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

The same pattern works for prompt packs, agent kits, docs, XDRs, and evaluation data.

I think this is especially useful for teams building internal AI coding standards across many repositories.

Repo:
https://github.com/flaviostutz/npmdata

If this solves a real problem in your workflow, star the project and tell me what kind of asset you need to distribute: prompts, agent rules, datasets, or config.