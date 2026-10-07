import { isBlank } from '../lib/ruby'

// Port of LineRangeParser: "10", "10-20", "#L10" and "#L10-L20" into the
// line/start_line fields GitHub's review comment API expects.
export interface GithubLinePayload {
  line?: number
  side?: 'RIGHT'
  start_line?: number
}

export class LineRange {
  constructor(
    readonly startLine: number,
    readonly endLine: number,
    readonly singleLine: boolean,
  ) {}

  valid() {
    return this.startLine > 0 && this.endLine > 0 && this.startLine <= this.endLine
  }

  toGithubPayload(): GithubLinePayload {
    if (!this.valid()) return {}
    const payload: GithubLinePayload = { line: this.endLine, side: 'RIGHT' }
    if (!this.singleLine) payload.start_line = this.startLine
    return payload
  }

  toString() {
    if (!this.valid()) return ''
    return this.singleLine ? String(this.startLine) : `${this.startLine}-${this.endLine}`
  }
}

export class LineRangeParser {
  static parse(input: string | number | null | undefined) {
    return new LineRangeParser().parse(input)
  }

  parse(input: string | number | null | undefined): LineRange | null {
    const text = input === null || input === undefined ? null : String(input)
    if (isBlank(text)) return null

    const normalized = this.normalizeInput(text.trim())
    if (normalized === '') return null

    return this.isRangeFormat(normalized) ? this.parseRange(normalized) : this.parseSingleLine(normalized)
  }

  private normalizeInput(input: string) {
    const withoutHash = input.startsWith('#') ? input.slice(1) : input
    return withoutHash.replace(/L(\d+)/gi, '$1').trim()
  }

  private isRangeFormat(input: string) {
    return /^\d+-\d+$/.test(input)
  }

  private parseRange(input: string) {
    const [first, second] = input.split('-')
    const startLine = this.parseInteger(first)
    const endLine = this.parseInteger(second)
    if (startLine === null || endLine === null) return null

    // Reversed ranges ("20-10") are normalized to ascending order.
    return new LineRange(Math.min(startLine, endLine), Math.max(startLine, endLine), false)
  }

  private parseSingleLine(input: string) {
    const line = this.parseInteger(input)
    return line === null ? null : new LineRange(line, line, true)
  }

  private parseInteger(value: string | undefined) {
    if (isBlank(value)) return null
    const cleaned = value.trim()
    if (!/^\d+$/.test(cleaned)) return null
    const parsed = Number.parseInt(cleaned, 10)
    return parsed > 0 ? parsed : null
  }
}
