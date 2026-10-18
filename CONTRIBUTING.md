# Contributing

## Development workflow

1. Read [README.md](README.md) and the sections of [SPEC.md](SPEC.md) relevant to
   the work. Resolve material ambiguities before implementing requirements.
2. Work in small, coherent slices. Each slice should deliver one reviewable
   behavior, fix, or documentation improvement.
3. Keep changes focused, update affected documentation, and run the checks
   appropriate to the slice. Record any checks that could not be run.
4. Review the diff, then make a Conventional Commit after each completed slice.
   Include only files belonging to that slice; preserve unrelated work.

Do not commit secrets, credentials, local configuration, or generated artifacts
unless the repository explicitly tracks them.

## Changes to the specification

If proposed work contradicts [PROJECT_SPEC.md](PROJECT_SPEC.md), pause the
conflicting work and first propose a specification change and a timestamped
Markdown delta in `deltas/` (for example,
`deltas/2026-10-18T07-17-29Z-random-forest-product-readme.md`). Describe the affected
sections, previous and revised requirements, and rationale. Obtain explicit user
approval before editing the spec, creating the delta, or implementing the
conflicting work.

Once approved, update the specification, timestamped delta and architecture
decision log together, then implement the approved work. Preserve historical
decisions and mark superseded requirements clearly.

## Branches and pull requests

- Never force push to `main`, including with `--force-with-lease`.
- Use a dedicated branch and a pull request targeting `main` for each change.
  Do not commit or push directly to `main` unless the task explicitly authorizes
  an exception to the branch and pull request workflow. Such an exception does
  not permit force pushing to `main`.
- Start branches from the latest `main` and use descriptive names, such as
  `feat/session-metadata` or `docs/setup-instructions`.
- Describe the change and its validation in the pull request.
- Before merging, check compatibility with the latest target branch: confirm
  the pull request is mergeable, resolve conflicts, review the final diff, and
  verify that required checks and reviews pass. Run relevant build, test, and
  lint checks against the combined changes where available.
- Recheck compatibility and required checks if the pull request or target branch
  changes before the merge. Do not merge while conflicts, failing required
  checks, or required reviews remain unresolved.

## Conventional Commits

Use this format:

```text
<type>[optional scope][!]: <short description>

[optional body]

[optional footers]
```

Use a concise, imperative description, such as `add setup instructions`.

Common types:

- `feat`: add functionality.
- `fix`: correct a defect.
- `docs`: change documentation.
- `refactor`: restructure code without changing behavior.
- `test`: add or update tests.
- `perf`: improve performance.
- `build`: change build tooling or dependencies.
- `ci`: change continuous integration.
- `chore`: perform maintenance that does not fit another type.
- `style`: change formatting without changing behavior.

Use a scope when it clarifies the affected area. Mark breaking changes with `!`
before the colon and explain the impact in a `BREAKING CHANGE:` footer.

Examples:

```text
docs: scaffold repository documentation
feat(capture): add session metadata
fix(parser): reject malformed records
feat(api)!: require a session identifier

BREAKING CHANGE: Requests must include a session identifier.
```

Commit completed slices as you work. Push, merge, and release only when requested
or authorized by the task.
