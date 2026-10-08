// Stands in for ordem-server: answers /up on ORDEM_HOST:PORT and echoes the
// desktop values it was started with, so tests can check the spawn contract.
const server = Bun.serve({
  hostname: process.env.ORDEM_HOST,
  port: Number(process.env.PORT),
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === '/up') return new Response('up')
    if (pathname === '/env') {
      return Response.json({
        mode: process.env.ORDEM_MODE,
        token: process.env.ORDEM_DESKTOP_TOKEN,
        stateDir: process.env.ORDEM_STATE_DIR,
        databasePath: process.env.DATABASE_PATH ?? null,
        leaked: process.env.ORDEM_LEAKED_SETTING ?? null,
      })
    }
    return new Response('not found', { status: 404 })
  },
})

process.on('SIGTERM', () => {
  server.stop(true)
  process.exit(0)
})
