import { defineConfig } from 'drizzle-kit'

// Rails owns migrations until cutover. `drizzle/0000_rails_baseline.sql` mirrors
// db/schema.rb and only builds test databases; re-run `bun run db:pull` after
// Rails migrations and copy changes into src/db/schema.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
