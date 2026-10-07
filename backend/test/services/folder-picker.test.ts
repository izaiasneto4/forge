import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { logger } from '../../src/lib/logger'
import { buildApplescript, DEFAULT_FOLDER_PROMPT, pickFolder } from '../../src/services/folder-picker'
import { createTestContext, type TestContext } from '../support/context'
import { createTempFolder } from '../support/git'

let ctx: TestContext
let folder: ReturnType<typeof createTempFolder>

beforeEach(() => {
  ctx = createTestContext()
  folder = createTempFolder()
})

afterEach(() => {
  folder.remove()
})

function stubOsascript(result: { stdout?: string; stderr?: string; success?: boolean }) {
  ctx.commands.on(['osascript', '-e'], result)
}

function sentScript() {
  return ctx.commands.commandsMatching(['osascript', '-e'])[0]?.command[2] ?? ''
}

describe('pickFolder', () => {
  test('returns null when osascript fails', async () => {
    stubOsascript({ success: false, stderr: 'failed' })

    expect(await pickFolder(ctx)).toBeNull()
    expect(sentScript()).toContain('choose folder')
  })

  test('returns the chosen directory without the trailing slash', async () => {
    stubOsascript({ stdout: `${folder.path}/\n` })

    expect(await pickFolder(ctx)).toBe(folder.path)
  })

  test('returns null for a blank result', async () => {
    stubOsascript({ stdout: ' \n' })

    expect(await pickFolder(ctx)).toBeNull()
  })

  test('returns null when the chosen directory does not exist', async () => {
    stubOsascript({ stdout: `${folder.path}/does-not-exist/\n` })

    expect(await pickFolder(ctx)).toBeNull()
  })

  test('logs and returns null when running osascript raises', async () => {
    const failure = 'boom'
    const logged = spyOn(logger, 'error')
    ctx.commands.on(['osascript'], () => {
      throw new Error(failure)
    })

    expect(await pickFolder(ctx)).toBeNull()
    expect(logged).toHaveBeenCalledWith(`FolderPickerService: ${failure}`)
    logged.mockRestore()
  })

  test('uses the default prompt', async () => {
    stubOsascript({ success: false })

    await pickFolder(ctx)

    expect(sentScript()).toBe(buildApplescript(DEFAULT_FOLDER_PROMPT))
  })

  test('accepts a custom prompt', async () => {
    const prompt = 'Pick a workspace'
    stubOsascript({ success: false })

    await pickFolder(ctx, prompt)

    expect(sentScript()).toContain(`with prompt "${prompt}"`)
  })

  test('handles concurrent calls independently', async () => {
    const calls = 5
    stubOsascript({ stdout: `${folder.path}\n` })

    const results = await Promise.all(Array.from({ length: calls }, () => pickFolder(ctx)))

    expect(results).toEqual(Array.from({ length: calls }, () => folder.path))
  })
})

describe('buildApplescript', () => {
  test('builds the System Events folder dialog', () => {
    const prompt = 'Select a folder'

    const script = buildApplescript(prompt)

    expect(script).toContain(prompt)
    expect(script).toContain('tell application "System Events"')
    expect(script).toContain('choose folder')
    expect(script).toContain('POSIX path of selectedFolder')
  })

  test.each(['Folder with "quotes"', 'Seleção de pasta', DEFAULT_FOLDER_PROMPT, 'x'.repeat(500)])('embeds the prompt %p verbatim', (prompt) => {
    expect(buildApplescript(prompt)).toContain(prompt)
  })

  test.each(['', 'Select folder: \\n\\t\\r'])('still builds a dialog for prompt %p', (prompt) => {
    expect(buildApplescript(prompt)).toContain('choose folder')
  })
})
