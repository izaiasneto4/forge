# Contributing

## Before you start

- Read [README.md](README.md) for setup and operating assumptions.
- Check existing issues and pull requests before starting duplicate work.
- Open an issue before large refactors or feature work.

## Local setup

Requirements:

- Bun `1.2.20`
- Node/npm
- authenticated `gh`
- at least one supported review CLI on your `PATH`: `claude`, `codex`, or `opencode`

Setup:

```bash
bin/setup
bin/dev
```

The app is intended to run locally by default at `http://127.0.0.1:3000`.

## Development workflow

1. Create a branch from `main`.
2. Make the smallest coherent change that solves the problem.
3. Add or update tests with the change.
4. Run the relevant checks locally.
5. Open a pull request with context and test results.

## Testing

Run the smallest relevant test set first, then broader checks before opening a PR.

```bash
bun run --cwd backend test
bun test backend/test/models/pull-request.test.ts
bun run --cwd backend typecheck
npm --prefix frontend test
```

If a check cannot run in your environment, note that explicitly in the pull request.

## Style

- TypeScript is strict: no `any`, no type assertions; validate unknown input with TypeBox.
- Use 2-space indentation, single quotes and no semicolons.
- Prefer small service modules with a single responsibility; pass the `AppContext` explicitly.
- Keep changes scoped to the task; avoid incidental cleanup unless it reduces risk.

## Pull requests

Each pull request should include:

- what changed
- why it changed
- screenshots or short clips for UI changes
- commands you ran
- follow-up work or known limitations

Use short, imperative, capitalized commit subjects.

## Security and secrets

- Never commit `.env` files, private keys, tokens, or raw credentials.
- Do not post exploitable details in public issues.
- Use [SECURITY.md](SECURITY.md) for vulnerability reporting.
