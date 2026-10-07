# Porting Rails → Bun: conventions

The Rails app in the repo root is the spec. Port behavior 1:1: same JSON keys and
values, same error codes and statuses, same side effects (DB writes, broadcasts,
enqueued jobs, subprocess calls). Read the Ruby source **and** its Ruby tests
(`test/**`); every scenario in the Ruby tests must have a Bun test.

## Rules

- TypeScript strict. No `any`, no type assertions (`as`, including `as const`), no
  non-null `!`. Narrow `unknown` with type guards or TypeBox (`@sinclair/typebox`).
  Literal constants use `literals(...)` (`src/lib/literals.ts`) or `Object.freeze({...})`.
- Style: 2 spaces, single quotes, no semicolons, small functions, sparse comments
  that explain *why* (a Rails quirk, a deliberate deviation).
- Tests (`bun:test`): declare inputs as named variables and assert against them;
  avoid hard-coded expected literals. No network, no real `gh`/`claude`/`codex`.
  Creating throwaway git repos with the `git` CLI in temp dirs is fine.
- Never call `Bun.spawn`/`child_process` directly from services: use
  `ctx.commands.run(argv, { cwd, env, input, timeoutMs, onOutputLine })`.
  Tests use `FakeCommandRunner` (`test/support/context.ts`).
- Don't commit. Don't start dev servers. Other agents are editing other files at
  the same time: `bun run typecheck` checks the whole project, so ignore errors
  in files you don't own.
- Only create/modify files in the paths assigned to you. Do not edit shared files
  (`src/models/**`, `src/db/**`, `src/lib/**`, `src/realtime/**`, `src/jobs/queue.ts`,
  `src/context.ts`, `test/support/{context,database,factories}.ts`, `package.json`).
  If you need a change there, put a helper in your own files or describe the
  change in your final report.

## Foundation you build on

| Rails | Bun |
|---|---|
| `Time.current` | `new Date()` (tests can use `setSystemTime` from `bun:test`) |
| `time.iso8601` | `iso8601(date)` in `src/lib/ruby.ts` (second precision, `Z`) |
| `blank?` / `present?` / `truncate` / `File.basename` | `isBlank`, `isPresent`, `truncate`, `rubyBasename` (`src/lib/ruby.ts`) |
| `ActiveRecord::RecordNotFound` / `RecordInvalid` / `ParameterMissing` | `RecordNotFoundError` / `RecordInvalidError` / `ParameterMissingError` (`src/lib/errors.ts`) |
| `Rails.logger` | `logger` (`src/lib/logger.ts`) |
| `ActionCable.server.broadcast` | `ctx.events.broadcast(stream, message)`; streams in `src/realtime/broadcaster.ts` |
| `UiEventBroadcaster.*` | `src/realtime/ui-events.ts` |
| `Job.perform_later(args)` / `.set(wait:)` | `ctx.jobs.enqueue(name, payload, { waitSeconds })` (`src/jobs/queue.ts`) |
| `Open3.capture3` / `popen2e` | `ctx.commands.run(...)` (`src/commands/runner.ts`) |
| `SyncMode.with_active` | `withSyncMode(fn)` (`src/services/sync-mode.ts`) |
| `Setting.*` | `new SettingStore(db)` (`src/models/setting.ts`) |
| `record.update!(...)` (validations + callbacks) | `updatePullRequest`, `updateReviewTask`, ... (`src/models/*`) |
| `record.update_column(s)` | `updatePullRequestColumns(db, id, changes)` |
| `transaction do ... end` + `after_commit` | `transaction(ctx, (txCtx) => ...)` (`src/models/record.ts`) |

`AppContext` (`src/context.ts`) is `{ db, events, jobs, commands }`; pass it to
anything that writes, broadcasts, enqueues or shells out. Models live in
`src/models/` (pull-request, pull-request-snapshot, review-task, review-comment,
review-iteration, agent-log, sync-state, setting). Read them before porting: most
`pull_request.foo?` helpers already exist there.

Already ported: `src/services/review-output-parser.ts` (ReviewOutputParser),
`src/services/path-validator.ts` (PathValidator), `src/services/repo-*`
(RepoSlugResolver/Scanner/SwitchResolver), `src/services/current-repo-recovery.ts`,
`src/services/github-cli-client.ts` (the `GithubCliClient` interface other services
consume; `src/services/github-cli.ts` implements it).

Test helpers: `createTestContext()` (in-memory DB + `RecordingBroadcaster` +
`JobQueue` + `FakeCommandRunner`), factories in `test/support/factories.ts`
(raw inserts, no validation or broadcasts).

## Final report

List: files created, test count and result, every deliberate deviation from Rails
(with the reason), and any change you need in a shared file.
