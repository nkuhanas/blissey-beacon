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
