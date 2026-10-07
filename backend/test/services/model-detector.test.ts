import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { detectModel, modelDetectors, UNKNOWN_MODEL, type ModelEnv } from '../../src/services/model-detector'
import { createTempFolder } from '../support/git'

let home: ReturnType<typeof createTempFolder>
let env: ModelEnv

function writeHomeFile(relativePath: string, content: string) {
  const path = join(home.path, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

const OPENCODE_FILE = '.local/state/opencode/model.json'
const CODEX_FILE = '.codex/config.toml'
const CLAUDE_FILE = '.claude/settings.json'

beforeEach(() => {
  home = createTempFolder()
  env = { HOME: home.path }
})

afterEach(() => {
  home.remove()
})

describe('detectModel', () => {
  test('returns the opencode model for opencode', () => {
    const [provider, model] = ['google', 'gemini-3-pro']
    writeHomeFile(OPENCODE_FILE, JSON.stringify({ recent: [{ providerID: provider, modelID: model }] }))

    expect(detectModel('opencode', env)).toBe(`${provider}/${model}`)
  })

  test('returns the codex model for codex', () => {
    const model = 'openai/gpt-4'
    writeHomeFile(CODEX_FILE, `model = "${model}"`)

    expect(detectModel('codex', env)).toBe(model)
  })

  test('returns the claude model for claude', () => {
    const model = 'claude-3.5-sonnet'
    writeHomeFile(CLAUDE_FILE, JSON.stringify({ model }))

    expect(detectModel('claude', env)).toBe(model)
  })

  test('returns unknown for unknown client', () => {
    expect(detectModel('unknown_client', env)).toBe(UNKNOWN_MODEL)
  })

  test('returns unknown for nil client', () => {
    expect(detectModel(null, env)).toBe(UNKNOWN_MODEL)
  })

  test('returns unknown when a config has an unexpected shape', () => {
    writeHomeFile(CLAUDE_FILE, JSON.stringify(['not', 'an', 'object']))

    expect(detectModel('claude', env)).toBe(UNKNOWN_MODEL)
  })
})

describe('opencode detection', () => {
  test('returns UNKNOWN_MODEL when file missing', () => {
    expect(modelDetectors.opencode(env)).toBe(UNKNOWN_MODEL)
  })

  test('returns UNKNOWN_MODEL for malformed JSON', () => {
    writeHomeFile(OPENCODE_FILE, '{ invalid json }')

    expect(modelDetectors.opencode(env)).toBe(UNKNOWN_MODEL)
  })

  test('returns UNKNOWN_MODEL when recent array empty', () => {
    writeHomeFile(OPENCODE_FILE, JSON.stringify({ recent: [] }))

    expect(modelDetectors.opencode(env)).toBe(UNKNOWN_MODEL)
  })

  test('returns UNKNOWN_MODEL when modelID missing', () => {
    writeHomeFile(OPENCODE_FILE, JSON.stringify({ recent: [{ providerID: 'google' }] }))

    expect(modelDetectors.opencode(env)).toBe(UNKNOWN_MODEL)
  })

  test('returns model only when provider missing', () => {
    const model = 'gemini-3-pro'
    writeHomeFile(OPENCODE_FILE, JSON.stringify({ recent: [{ modelID: model }] }))

    expect(modelDetectors.opencode(env)).toBe(model)
  })

  test('returns provider/model format', () => {
    const [provider, model] = ['google', 'gemini-3-pro']
    writeHomeFile(OPENCODE_FILE, JSON.stringify({ recent: [{ providerID: provider, modelID: model }] }))

    expect(modelDetectors.opencode(env)).toBe(`${provider}/${model}`)
  })
})

describe('codex detection', () => {
  test('returns UNKNOWN_MODEL when file missing', () => {
    expect(modelDetectors.codex(env)).toBe(UNKNOWN_MODEL)
  })

  test('returns UNKNOWN_MODEL when model key missing', () => {
    writeHomeFile(CODEX_FILE, 'other_key = value')

    expect(modelDetectors.codex(env)).toBe(UNKNOWN_MODEL)
  })

  test('returns model from TOML config', () => {
    const model = 'openai/gpt-4'
    writeHomeFile(CODEX_FILE, `model = "${model}"`)

    expect(modelDetectors.codex(env)).toBe(model)
  })

  test('handles model with spaces', () => {
    const model = 'openai/gpt-4'
    writeHomeFile(CODEX_FILE, `model =  "${model}"`)

    expect(modelDetectors.codex(env)).toBe(model)
  })

  test('only reads a top-level model key', () => {
    const model = 'gpt-5'
    writeHomeFile(CODEX_FILE, `approval = "never"\n  model = "indented"\nmodel = "${model}"\n`)

    expect(modelDetectors.codex(env)).toBe(model)
  })
})

describe('claude detection', () => {
  test('prefers ANTHROPIC_MODEL env var', () => {
    const model = 'claude-3.5-sonnet'

    expect(modelDetectors.claude({ ...env, ANTHROPIC_MODEL: model })).toBe(model)
  })

  test('prefers CLAUDE_MODEL env var over config', () => {
    const model = 'claude-3-opus'
    writeHomeFile(CLAUDE_FILE, JSON.stringify({ model: 'claude-3.5-sonnet' }))

    expect(modelDetectors.claude({ ...env, CLAUDE_MODEL: model })).toBe(model)
  })

  test('reads model from config file', () => {
    const model = 'claude-3.5-sonnet'
    writeHomeFile(CLAUDE_FILE, JSON.stringify({ model }))

    expect(modelDetectors.claude(env)).toBe(model)
  })

  test('reads model from preferences.model in config', () => {
    const model = 'claude-3-opus'
    writeHomeFile(CLAUDE_FILE, JSON.stringify({ preferences: { model } }))

    expect(modelDetectors.claude(env)).toBe(model)
  })

  test('returns default when config missing', () => {
    const defaultModel = 'claude'

    expect(modelDetectors.claude(env)).toBe(defaultModel)
  })

  test('returns default for malformed JSON', () => {
    const defaultModel = 'claude'
    writeHomeFile(CLAUDE_FILE, '{ invalid json }')

    expect(modelDetectors.claude(env)).toBe(defaultModel)
  })
})
