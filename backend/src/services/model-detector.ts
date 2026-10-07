import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../lib/logger'
import { isPresent } from '../lib/ruby'

// Port of ModelDetector: best-effort guess of the model each AI CLI will use,
// read from its local config (same files and env vars as Rails).
export const UNKNOWN_MODEL = 'unknown'

export type ModelEnv = Record<string, string | undefined>

// File.expand_path("~/...") honours $HOME.
function homePath(env: ModelEnv, ...segments: string[]) {
  return join(env.HOME ?? homedir(), ...segments)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Ruby truthiness: only nil and false are falsy.
function truthy(value: unknown) {
  return value !== null && value !== undefined && value !== false
}

// `present?` for the JSON scalars these configs hold.
function presentValue(value: unknown) {
  if (!truthy(value)) return false
  return typeof value === 'string' ? isPresent(value) : true
}

// Hash#dig("model") on the parsed "preferences" value.
function nestedModel(preferences: unknown) {
  if (preferences === null || preferences === undefined) return undefined
  if (!isRecord(preferences)) throw new TypeError('preferences is not an object')
  return preferences.model
}

function rubyToString(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function detectOpencodeModel(env: ModelEnv) {
  const modelFile = homePath(env, '.local', 'state', 'opencode', 'model.json')
  if (!existsSync(modelFile)) return UNKNOWN_MODEL

  let data: unknown
  try {
    data = JSON.parse(readFileSync(modelFile, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) return UNKNOWN_MODEL
    throw error
  }
  if (!isRecord(data)) throw new TypeError('opencode model.json is not an object')

  const recentList = data.recent
  const recent = Array.isArray(recentList) ? recentList[0] : undefined
  if (!isRecord(recent)) return UNKNOWN_MODEL

  const provider = recent.providerID
  const model = recent.modelID
  if (!truthy(model)) return UNKNOWN_MODEL

  // Provider included for clarity, e.g. "google/antigravity-gemini-3-pro".
  return presentValue(provider) ? `${rubyToString(provider)}/${rubyToString(model)}` : rubyToString(model)
}

function detectCodexModel(env: ModelEnv) {
  const configFile = homePath(env, '.codex', 'config.toml')
  if (!existsSync(configFile)) return UNKNOWN_MODEL

  // Top-level `model = "..."` only; no full TOML parsing.
  const match = /^model\s*=\s*"([^"]+)"/m.exec(readFileSync(configFile, 'utf8'))
  return match?.[1] ?? UNKNOWN_MODEL
}

function detectClaudeModel(env: ModelEnv) {
  // `ENV["ANTHROPIC_MODEL"] || ENV["CLAUDE_MODEL"]`: an empty ANTHROPIC_MODEL
  // still wins over CLAUDE_MODEL (empty strings are truthy in Ruby).
  const envModel = env.ANTHROPIC_MODEL ?? env.CLAUDE_MODEL
  if (isPresent(envModel)) return envModel

  const configFile = homePath(env, '.claude', 'settings.json')
  if (existsSync(configFile)) {
    let config: unknown
    try {
      config = JSON.parse(readFileSync(configFile, 'utf8'))
    } catch (error) {
      if (error instanceof SyntaxError) return 'claude'
      throw error
    }
    if (!isRecord(config)) throw new TypeError('claude settings.json is not an object')

    // `config["model"] || config.dig("preferences", "model")`
    const model = truthy(config.model) ? config.model : nestedModel(config.preferences)
    if (presentValue(model)) return rubyToString(model)
  }

  // Can't detect reliably (the CLI may get -m); "claude" identifies the client.
  return 'claude'
}

function detectFor(cliClient: string | null, env: ModelEnv) {
  switch (cliClient) {
    case 'opencode':
      return detectOpencodeModel(env)
    case 'codex':
      return detectCodexModel(env)
    case 'claude':
      return detectClaudeModel(env)
    default:
      return UNKNOWN_MODEL
  }
}

export function detectModel(cliClient: string | null, env: ModelEnv = process.env): string {
  try {
    return detectFor(cliClient, env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`ModelDetector: Failed to detect model for ${cliClient ?? ''}: ${message}`)
    return UNKNOWN_MODEL
  }
}

export const modelDetectors = { opencode: detectOpencodeModel, codex: detectCodexModel, claude: detectClaudeModel }
