# _local-bdr-002: GitHub star growth market plan

## Context and Problem Statement

npmdata already solves a concrete problem: versioned distribution of prompts, agent kits, XDRs, datasets, and config files from npm packages or plain git repositories. The current gap is not capability but positioning and repeatable distribution. Which market plan should npmdata follow to increase GitHub stars with a clear audience and launch sequence?

## Decision Outcome

**AI-coder wedge with proof-driven launch**
npmdata must be marketed first to AI coders and platform engineers who need to share prompts, agent kits, eval data, and project instructions across repositories, while keeping a secondary message for broader file-sharing use cases.

### Implementation Details

- Primary audience: AI coding teams, prompt engineers, agent-kit maintainers, and internal developer-platform owners working from GitHub.
- Secondary audience: teams distributing datasets, docs, XDRs, or runtime config across repos.
- Positioning statement: npmdata is the easiest way to ship prompt packs, agent kits, and shared repo assets as versioned dependencies from npm or git.
- Message pillars:
  - Version prompts and agent assets like code.
  - Pull from npm or plain git without submodules or copy-paste.
  - Keep updates safe with `extract`, `check`, `purge`, and `.npmdata` ownership markers.
- Primary CTA: visit the repo, inspect examples, and star it if this solves asset distribution for AI coding workflows.
- Proof to reuse in all media: git-source workflow, curated package workflow, recursive package composition, and the dataset-sharing guide.
- Launch phases:
  - Phase 0, foundation, 1 week: tighten messaging, prepare code snippets, and publish the first media kit in `docs/media`.
  - Phase 1, launch burst, 2 weeks: publish on X, LinkedIn, Dev.to, Reddit, Hacker News, and AI/dev communities; answer every comment within 24 hours.
  - Phase 2, growth loop, 6 weeks: publish one technical proof post each week, convert objections into docs/examples, and repost user wins with a star CTA.
- Growth strategy:
  - Lead with one narrow use case per post: prompts, agent instructions, XDRs, eval datasets, or shared configs.
  - Always show a real command and a real file tree.
  - Repackage long-form content into short posts and community variants instead of inventing new themes each week.
  - Track weekly GitHub stars, repo visits, stars-per-visit, comment volume, and which use case drove the click.
  - Favor technical communities where readers can test the tool immediately over broad startup audiences.
- Guardrails:
  - Do not market npmdata as generic AI infrastructure.
  - Do not publish without a concrete example and explicit GitHub CTA.
  - Keep claims factual and centered on file distribution, versioning, and safe updates.

## Considered Options

* (REJECTED) **Broad file-sharing utility for all developers** - Position npmdata as a generic way to move files between projects.
  * Reason: Accurate but weak. It does not create a memorable wedge or community-level word of mouth.
* (REJECTED) **Documentation and config tooling first** - Focus on docs, XDRs, and config distribution for platform teams.
  * Reason: Valuable secondary market, but less urgent and less socially shareable than AI-coder workflows.
* (CHOSEN) **AI-coder asset distribution wedge** - Lead with prompts, agent kits, eval data, and instructions distributed from npm or git.
  * Reason: Stronger urgency, clearer novelty, and a tighter link between technical proof, GitHub discovery, and star conversion.

## References

- `README.md`
- `docs/share-dataset-files-with-npmdata.md`
- `docs/media`