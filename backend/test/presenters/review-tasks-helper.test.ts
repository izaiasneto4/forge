import { describe, expect, test } from 'bun:test'
import { codeSuggestion, detectLanguageFromFile, formatReviewDuration, severityEmoji } from '../../src/presenters/review-tasks-helper'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('severityEmoji', () => {
  const alarm = '🚨'
  const warningSign = '⚠️'
  const information = 'ℹ️'
  const bulb = '💡'
  const magnifier = '🔍'
  const speechBubble = '💬'

  test.each([
    ['critical', alarm],
    ['error', alarm],
    ['major', warningSign],
    ['warning', warningSign],
    ['minor', information],
    ['suggestion', bulb],
    ['nitpick', magnifier],
    ['unknown', speechBubble],
    ['', speechBubble],
    [null, speechBubble],
  ])('maps %p to %p', (severity, emoji) => {
    expect(severityEmoji(severity)).toBe(emoji)
  })
})

describe('formatReviewDuration', () => {
  const startedAt = new Date()
  const after = (milliseconds: number) => new Date(startedAt.getTime() + milliseconds)

  test('returns null when either time is missing', () => {
    expect(formatReviewDuration(null, startedAt)).toBeNull()
    expect(formatReviewDuration(startedAt, null)).toBeNull()
    expect(formatReviewDuration(null, null)).toBeNull()
  })

  test('formats seconds', () => {
    const seconds = 30

    expect(formatReviewDuration(startedAt, after(seconds * SECOND))).toBe(`${seconds}s`)
  })

  test('formats whole minutes', () => {
    const minutes = 5

    expect(formatReviewDuration(startedAt, after(minutes * MINUTE))).toBe(`${minutes}m`)
  })

  test('formats minutes and seconds', () => {
    const minutes = 5
    const seconds = 30

    expect(formatReviewDuration(startedAt, after(minutes * MINUTE + seconds * SECOND))).toBe(`${minutes}m ${seconds}s`)
  })

  test('formats whole hours', () => {
    const hours = 2

    expect(formatReviewDuration(startedAt, after(hours * HOUR))).toBe(`${hours}h`)
  })

  test('formats hours and minutes, dropping seconds', () => {
    const hours = 2
    const minutes = 30
    const seconds = 15

    expect(formatReviewDuration(startedAt, after(hours * HOUR + minutes * MINUTE + seconds * SECOND))).toBe(`${hours}h ${minutes}m`)
  })

  test('truncates fractional seconds like Float#to_i', () => {
    const seconds = 59

    expect(formatReviewDuration(startedAt, after(seconds * SECOND + 999))).toBe(`${seconds}s`)
  })
})

describe('codeSuggestion', () => {
  test.each([
    'const items = await fetchItems();',
    '```ruby\ndef fix\nend\n```',
    'items.map(&:id)',
    'value == other',
    '<div class="x">',
    'foo.bar(1)',
    'Note: rename it',
  ])('treats %p as code', (suggestion) => {
    expect(codeSuggestion(suggestion)).toBe(true)
  })

  test.each([
    "Normalize pathname before matching and add '/embed/' handling.",
    'Consider renaming this method for clarity',
    'user&.name',
    'save!(validate: false)',
    '',
    '   \n  ',
    null,
  ])('treats %p as prose', (suggestion) => {
    expect(codeSuggestion(suggestion)).toBe(false)
  })
})

describe('detectLanguageFromFile', () => {
  test.each(['', null, undefined])('returns null for blank filename %p', (filename) => {
    expect(detectLanguageFromFile(filename)).toBeNull()
  })

  test.each([
    ['test.rb', 'ruby'],
    ['model.rb', 'ruby'],
    ['app.js', 'javascript'],
    ['component.jsx', 'javascript'],
    ['app.ts', 'typescript'],
    ['component.tsx', 'typescript'],
    ['script.py', 'python'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['App.java', 'java'],
    ['Main.kt', 'kotlin'],
    ['file.swift', 'swift'],
    ['Program.cs', 'csharp'],
    ['main.cpp', 'cpp'],
    ['header.hpp', 'cpp'],
    ['main.c', 'c'],
    ['header.h', 'c'],
    ['index.php', 'php'],
    ['script.sh', 'bash'],
    ['config.yml', 'yaml'],
    ['settings.yaml', 'yaml'],
    ['data.json', 'json'],
    ['README.md', 'markdown'],
    ['index.html', 'html'],
    ['view.html.erb', 'erb'],
    ['style.css', 'css'],
    ['style.scss', 'scss'],
    ['style.sass', 'sass'],
    ['query.sql', 'sql'],
    ['module.ex', 'elixir'],
    ['script.exs', 'elixir'],
    ['test.RB', 'ruby'],
    ['app.JS', 'javascript'],
    ['app/models/user.rb', 'ruby'],
    ['src/components/Button.jsx', 'javascript'],
  ])('detects %p as %p', (filename, language) => {
    expect(detectLanguageFromFile(filename)).toBe(language)
  })

  test('returns the extension itself for unknown types', () => {
    const extension = 'unknown'

    expect(detectLanguageFromFile(`file.${extension}`)).toBe(extension)
  })

  test.each(['N/A', 'Makefile', '.bashrc', 'dir.d/file'])('returns an empty language for %p, which has no extension', (filename) => {
    const noExtension = ''

    expect(detectLanguageFromFile(filename)).toBe(noExtension)
  })
})
