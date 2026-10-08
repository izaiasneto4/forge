import type { AppContext } from '../context'
import { logger } from '../lib/logger'
import { isBlank } from '../lib/ruby'
import { isDirectory } from './git'

// Port of FolderPickerService: the macOS "choose folder" dialog via osascript.

export const DEFAULT_FOLDER_PROMPT = 'Select your repositories folder'
export const REPOSITORY_FOLDER_PROMPT = 'Select a repository, or the folder that holds your repositories'

// The prompt is interpolated verbatim (Rails did not escape it either).
export function buildApplescript(prompt: string) {
  return `tell application "System Events"
  activate
  set selectedFolder to choose folder with prompt "${prompt}"
  return POSIX path of selectedFolder
end tell
`
}

// The chosen directory without its trailing slash; null when the dialog is
// cancelled, fails, or returns something that is not an existing directory.
export async function pickFolder(ctx: AppContext, prompt = DEFAULT_FOLDER_PROMPT): Promise<string | null> {
  try {
    const result = await ctx.commands.run(['osascript', '-e', buildApplescript(prompt)])
    if (!result.success || isBlank(result.stdout)) return null

    const path = result.stdout.trim().replace(/\/$/, '')
    return isDirectory(path) ? path : null
  } catch (error) {
    logger.error(`FolderPickerService: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
