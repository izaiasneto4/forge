// Entry point of the compiled desktop server (scripts/build-server.ts).
// `ordem-server cli <args>` runs the ordem CLI instead, which is what the
// desktop app's "Install Command Line Tool" shim calls.
if (process.argv[2] === 'cli') {
  const { runCli } = await import('./cli/main')
  await runCli(process.argv.slice(3))
} else {
  await import('./index')
}

export {}
