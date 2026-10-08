#!/usr/bin/env bun
// Bundles Electron main and the preload into dist-electron/ as CommonJS.
//   bun scripts/build.ts            one build
//   bun scripts/build.ts --watch    rebuild when desktop/src or shared/ change
// Everything but `electron` is inlined, so app.asar needs no node_modules and the
// sandboxed preload requires nothing it cannot load.
import { watch } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
export const OUT_DIR = join(desktopRoot, 'dist-electron')
const ENTRYPOINTS = [join(desktopRoot, 'src', 'main.ts'), join(desktopRoot, 'src', 'preload.ts')]

export async function buildShell() {
  await rm(OUT_DIR, { recursive: true, force: true })
  const result = await Bun.build({
    entrypoints: ENTRYPOINTS,
    outdir: OUT_DIR,
    target: 'node',
    format: 'cjs',
    external: ['electron'],
    naming: '[name].cjs',
    sourcemap: 'none',
    minify: false,
  })
  if (!result.success) {
    for (const message of result.logs) console.error(message)
    throw new Error('Desktop shell build failed')
  }
  console.log(`Built ${result.outputs.map((output) => output.path).join(', ')}`)
}

if (import.meta.main) {
  await buildShell()
  if (process.argv.includes('--watch')) {
    let pending: ReturnType<typeof setTimeout> | null = null
    const rebuild = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        buildShell().catch((error: unknown) => console.error(error))
      }, 100)
    }
    watch(join(desktopRoot, 'src'), { recursive: true }, rebuild)
    watch(join(desktopRoot, '..', 'shared'), { recursive: true }, rebuild)
    console.log('Watching desktop/src and shared/ for changes')
  }
}
