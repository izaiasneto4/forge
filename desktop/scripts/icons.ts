#!/usr/bin/env bun
// Renders desktop/resources/icon.png (1024 px) from public/icon.svg, placed on
// the macOS icon grid (an 824 px tile inside a 1024 px canvas) so the Dock and
// the Linux launcher show it at the same visual size as other apps.
// electron-builder derives icon.icns, icon.ico and the Linux sizes from it.
//   bun desktop/scripts/icons.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const desktopRoot = join(repositoryRoot, 'desktop')
const sourceSvg = join(repositoryRoot, 'public', 'icon.svg')
const outputPng = join(desktopRoot, 'resources', 'icon.png')
const CANVAS = 1024
const TILE = 824
const SOURCE = 512

export function desktopIconSvg(source: string) {
  const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const offset = (CANVAS - TILE) / 2
  const scale = TILE / SOURCE
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}"><g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g></svg>`
}

// Electron renders the SVG offscreen and writes the PNG; no image tools needed.
const RENDERER = `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const [svgPath, pngPath, size] = process.argv.slice(-3)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: Number(size), height: Number(size), show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  window.webContents.setZoomFactor(1)
  const html = '<html><body style="margin:0;background:transparent;overflow:hidden">' + readFileSync(svgPath, 'utf8') + '</body></html>'
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: Number(size), height: Number(size) })
  writeFileSync(pngPath, image.resize({ width: Number(size), height: Number(size) }).toPNG())
  app.exit(0)
})
`

if (import.meta.main) {
  const workDir = mkdtempSync(join(tmpdir(), 'ordem-icon-'))
  try {
    const svgPath = join(workDir, 'icon.svg')
    const rendererPath = join(workDir, 'render.cjs')
    writeFileSync(svgPath, desktopIconSvg(readFileSync(sourceSvg, 'utf8')))
    writeFileSync(rendererPath, RENDERER)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const electron = join(desktopRoot, 'node_modules', '.bin', 'electron')
    const render = Bun.spawn([electron, rendererPath, svgPath, outputPng, String(CANVAS)], { env, stdout: 'inherit', stderr: 'inherit' })
    if ((await render.exited) !== 0) throw new Error('Icon render failed')
    console.log(`Wrote ${outputPng}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
