const PR_URL = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\S*/

export function splitPullRequestInput(value: string) {
  const match = value.match(PR_URL)
  if (!match) return { url: null, focus: value.trim() }
  return { url: match[0], focus: value.replace(match[0], '').trim() }
}
