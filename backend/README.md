# Forge backend (Bun + Elysia)

TypeScript port of the Rails API, rolled out route by route. Ported routes are served here; everything else is forwarded to Rails, so the React app works the same with either backend.

```sh
bun install
bun run dev        # http://localhost:3100, falls back to Rails at RAILS_URL
bun test
bun run typecheck
```

Point the Vite dev proxy at it with `FORGE_API_URL=http://localhost:3100`. `/cable` still goes straight to Rails.

| Env | Default |
|---|---|
| `PORT` | `3100` |
| `RAILS_URL` | `http://localhost:3000` |
| `DATABASE_PATH` | `../storage/development.sqlite3` (shared with Rails) |

## Contract rules

- Same paths, snake_case keys, and `{ ...payload, ok: true }` / `{ ok: false, error: { code, message, details? } }` envelope as `Api::V1::BaseController`.
- Each route declares a `response` schema with Elysia's `t`; a payload that breaks it returns a 500 instead of reaching the client.

## Database

Rails owns migrations until cutover. `src/db/schema.ts` was introspected from the Rails DB, with `railsDatetime` / `railsBoolean` columns that read and write Rails' storage format. After a Rails migration, run `bun run db:pull` and copy the changes from `.drizzle-pull/` into `src/db/schema.ts` and `drizzle/0000_rails_baseline.sql`. The baseline is only used to build test databases.
