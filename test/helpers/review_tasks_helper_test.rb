require "test_helper"

class ReviewTasksHelperTest < ActionView::TestCase
  include ReviewTasksHelper

  # cli_client_icon tests
  test "cli_client_icon returns SVG for known clients" do
    assert_includes cli_client_icon("claude"), "<svg"
    assert_includes cli_client_icon("codex"), "<svg"
    assert_includes cli_client_icon("opencode"), "<svg"
  end

  test "cli_client_icon is case insensitive" do
    assert_includes cli_client_icon("CLAUDE"), "<svg"
    assert_includes cli_client_icon("ClaUdE"), "<svg"
    assert_includes cli_client_icon("CoDeX"), "<svg"
  end

  test "cli_client_icon uses custom CSS class" do
    result = cli_client_icon("claude", class: "w-5 h-5")
    assert_includes result, 'class="w-5 h-5"'
    refute_includes result, 'class="w-3.5 h-3.5"'
  end

  test "cli_client_icon returns empty string for unknown client" do
    assert_equal "", cli_client_icon("unknown")
    assert_equal "", cli_client_icon("")
  end

  # severity_emoji tests
  test "severity_emoji returns correct emoji for critical" do
    assert_equal "🚨", severity_emoji("critical")
  end

  test "severity_emoji returns correct emoji for error" do
    assert_equal "🚨", severity_emoji("error")
  end

  test "severity_emoji returns correct emoji for major" do
    assert_equal "⚠️", severity_emoji("major")
  end

  test "severity_emoji returns correct emoji for warning" do
    assert_equal "⚠️", severity_emoji("warning")
  end

  test "severity_emoji returns correct emoji for minor" do
    assert_equal "ℹ️", severity_emoji("minor")
  end

  test "severity_emoji returns correct emoji for suggestion" do
    assert_equal "💡", severity_emoji("suggestion")
  end

  test "severity_emoji returns correct emoji for nitpick" do
    assert_equal "🔍", severity_emoji("nitpick")
  end

  test "severity_emoji returns default emoji for unknown severity" do
    assert_equal "💬", severity_emoji("unknown")
    assert_equal "💬", severity_emoji("")
  end

  # severity_border_class tests
  test "severity_border_class returns correct class for critical" do
    assert_equal "border-red-500", severity_border_class("critical")
  end

  test "severity_border_class returns correct class for error" do
    assert_equal "border-red-500", severity_border_class("error")
  end

  test "severity_border_class returns correct class for major" do
    assert_equal "border-yellow-500", severity_border_class("major")
  end

  test "severity_border_class returns correct class for warning" do
    assert_equal "border-yellow-500", severity_border_class("warning")
  end

  test "severity_border_class returns correct class for minor" do
    assert_equal "border-blue-500", severity_border_class("minor")
  end

  test "severity_border_class returns correct class for suggestion" do
    assert_equal "border-green-500", severity_border_class("suggestion")
  end

  test "severity_border_class returns correct class for nitpick" do
    assert_equal "border-gray-400", severity_border_class("nitpick")
  end

  test "severity_border_class returns default class for unknown" do
    assert_equal "border-gray-300", severity_border_class("unknown")
  end

  # severity_badge_class tests
  test "severity_badge_class returns correct class for critical" do
    assert_equal "linear-badge-red", severity_badge_class("critical")
  end

  test "severity_badge_class returns correct class for major" do
    assert_equal "linear-badge-yellow", severity_badge_class("major")
  end

  test "severity_badge_class returns correct class for minor" do
    assert_equal "linear-badge-blue", severity_badge_class("minor")
  end

  test "severity_badge_class returns correct class for suggestion" do
    assert_equal "linear-badge-green", severity_badge_class("suggestion")
  end

  test "severity_badge_class returns correct class for nitpick" do
    assert_equal "linear-badge-default", severity_badge_class("nitpick")
  end

  test "severity_badge_class returns default class for unknown" do
    assert_equal "linear-badge-default", severity_badge_class("unknown")
  end

  # status_badge_class tests
  test "status_badge_class returns correct class for pending" do
    assert_equal "linear-badge-yellow", status_badge_class("pending")
  end

  test "status_badge_class returns correct class for addressed" do
    assert_equal "linear-badge-green", status_badge_class("addressed")
  end

  test "status_badge_class returns correct class for dismissed" do
    assert_equal "linear-badge-default", status_badge_class("dismissed")
  end

  test "status_badge_class returns default class for unknown" do
    assert_equal "linear-badge-default", status_badge_class("unknown")
  end

  # state_badge_class tests
  test "state_badge_class returns correct class for pending_review" do
    assert_equal "bg-gray-200 text-gray-700", state_badge_class("pending_review")
  end

  test "state_badge_class returns correct class for in_review" do
    assert_equal "bg-yellow-200 text-yellow-800", state_badge_class("in_review")
  end

  test "state_badge_class returns correct class for reviewed" do
    assert_equal "bg-blue-200 text-blue-800", state_badge_class("reviewed")
  end

  test "state_badge_class returns correct class for waiting_implementation" do
    assert_equal "bg-orange-200 text-orange-800", state_badge_class("waiting_implementation")
  end

  test "state_badge_class returns correct class for done" do
    assert_equal "bg-green-200 text-green-800", state_badge_class("done")
  end

  test "state_badge_class returns default class for unknown" do
    assert_equal "bg-gray-200 text-gray-700", state_badge_class("unknown")
  end

  # log_type_class tests
  test "log_type_class returns correct class for error" do
    assert_equal "text-red-400", log_type_class("error")
  end

  test "log_type_class returns correct class for status" do
    assert_equal "text-[color:var(--color-accent)] font-medium", log_type_class("status")
  end

  test "log_type_class returns default class for other types" do
    assert_equal "text-[color:var(--color-text-secondary)]", log_type_class("info")
    assert_equal "text-[color:var(--color-text-secondary)]", log_type_class("debug")
  end

  # format_review_duration tests
  test "format_review_duration returns nil when times are missing" do
    assert_nil format_review_duration(nil, Time.now)
    assert_nil format_review_duration(Time.now, nil)
    assert_nil format_review_duration(nil, nil)
  end

  test "format_review_duration formats seconds correctly" do
    started = Time.now
    completed = started + 30.seconds
    assert_equal "30s", format_review_duration(started, completed)
  end

  test "format_review_duration formats minutes correctly" do
    started = Time.now
    completed = started + 5.minutes
    assert_equal "5m", format_review_duration(started, completed)
  end

  test "format_review_duration formats minutes and seconds" do
    started = Time.now
    completed = started + 5.minutes + 30.seconds
    assert_equal "5m 30s", format_review_duration(started, completed)
  end

  test "format_review_duration formats hours correctly" do
    started = Time.now
    completed = started + 2.hours
    assert_equal "2h", format_review_duration(started, completed)
  end

  test "format_review_duration formats hours and minutes" do
    started = Time.now
    completed = started + 2.hours + 30.minutes
    assert_equal "2h 30m", format_review_duration(started, completed)
  end

  # render_markdown tests
  test "render_markdown returns empty string for blank input" do
    assert_equal "", render_markdown("")
    assert_equal "", render_markdown(nil)
  end

  test "render_markdown renders basic markdown" do
    result = render_markdown("**bold**")
    assert_includes result, "<strong>bold</strong>"
  end

  test "render_markdown renders code blocks" do
    result = render_markdown("```ruby\ndef foo\nend\n```")
    assert_includes result, "<div class=\"code-block"
  end

  test "render_markdown renders tables" do
    result = render_markdown("| header |\n|--------|\n| cell   |")
    assert_includes result, "<table"
  end

  test "render_markdown renders autolinks" do
    result = render_markdown("https://example.com")
    assert_includes result, "<a"
  end

  test "render_markdown is html_safe" do
    result = render_markdown("**test**")
    assert result.html_safe?
  end

  # render_code_block tests
  test "render_code_block returns empty string for blank code" do
    assert_equal "", render_code_block("")
    assert_equal "", render_code_block(nil)
  end

  test "render_code_block includes language" do
    result = render_code_block("def foo; end", "ruby")
    assert_includes result, "<span class=\"text-gray-400 text-xs font-mono\">ruby</span>"
  end

  test "render_code_block includes copy button" do
    result = render_code_block("test code")
    assert_includes result, "data-controller=\"copy\""
    assert_includes result, "data-action=\"click->copy#copy\""
  end

  test "render_code_block is html_safe" do
    result = render_code_block("code")
    assert result.html_safe?
  end

  # detect_language_from_file tests
  test "detect_language_from_file returns nil for blank filename" do
    assert_nil detect_language_from_file("")
    assert_nil detect_language_from_file(nil)
  end

  test "detect_language_from_file detects ruby files" do
    assert_equal "ruby", detect_language_from_file("test.rb")
    assert_equal "ruby", detect_language_from_file("model.rb")
  end

  test "detect_language_from_file detects javascript files" do
    assert_equal "javascript", detect_language_from_file("app.js")
    assert_equal "javascript", detect_language_from_file("component.jsx")
  end

  test "detect_language_from_file detects typescript files" do
    assert_equal "typescript", detect_language_from_file("app.ts")
    assert_equal "typescript", detect_language_from_file("component.tsx")
  end

  test "detect_language_from_file detects python files" do
    assert_equal "python", detect_language_from_file("script.py")
  end

  test "detect_language_from_file detects go files" do
    assert_equal "go", detect_language_from_file("main.go")
  end

  test "detect_language_from_file detects rust files" do
    assert_equal "rust", detect_language_from_file("lib.rs")
  end

  test "detect_language_from_file detects java files" do
    assert_equal "java", detect_language_from_file("App.java")
  end

  test "detect_language_from_file detects kotlin files" do
    assert_equal "kotlin", detect_language_from_file("Main.kt")
  end

  test "detect_language_from_file detects swift files" do
    assert_equal "swift", detect_language_from_file("file.swift")
  end

  test "detect_language_from_file detects csharp files" do
    assert_equal "csharp", detect_language_from_file("Program.cs")
  end

  test "detect_language_from_file detects cpp files" do
    assert_equal "cpp", detect_language_from_file("main.cpp")
    assert_equal "cpp", detect_language_from_file("header.hpp")
  end

  test "detect_language_from_file detects c files" do
    assert_equal "c", detect_language_from_file("main.c")
    assert_equal "c", detect_language_from_file("header.h")
  end

  test "detect_language_from_file detects php files" do
    assert_equal "php", detect_language_from_file("index.php")
  end

  test "detect_language_from_file detects shell files" do
    assert_equal "bash", detect_language_from_file("script.sh")
  end

  test "detect_language_from_file detects yaml files" do
    assert_equal "yaml", detect_language_from_file("config.yml")
    assert_equal "yaml", detect_language_from_file("settings.yaml")
  end

  test "detect_language_from_file detects json files" do
    assert_equal "json", detect_language_from_file("data.json")
  end

  test "detect_language_from_file detects markdown files" do
    assert_equal "markdown", detect_language_from_file("README.md")
  end

  test "detect_language_from_file detects html files" do
    assert_equal "html", detect_language_from_file("index.html")
  end

  test "detect_language_from_file detects erb files" do
    assert_equal "erb", detect_language_from_file("view.html.erb")
  end

  test "detect_language_from_file detects css files" do
    assert_equal "css", detect_language_from_file("style.css")
  end

  test "detect_language_from_file detects scss files" do
    assert_equal "scss", detect_language_from_file("style.scss")
  end

  test "detect_language_from_file detects sass files" do
    assert_equal "sass", detect_language_from_file("style.sass")
  end

  test "detect_language_from_file detects sql files" do
    assert_equal "sql", detect_language_from_file("query.sql")
  end

  test "detect_language_from_file detects elixir files" do
    assert_equal "elixir", detect_language_from_file("module.ex")
    assert_equal "elixir", detect_language_from_file("script.exs")
  end

  test "detect_language_from_file is case insensitive" do
    assert_equal "ruby", detect_language_from_file("test.RB")
    assert_equal "javascript", detect_language_from_file("app.JS")
  end

  test "detect_language_from_file returns extension for unknown types" do
    assert_equal "unknown", detect_language_from_file("file.unknown")
  end

  test "detect_language_from_file handles paths with directories" do
    assert_equal "ruby", detect_language_from_file("app/models/user.rb")
    assert_equal "javascript", detect_language_from_file("src/components/Button.jsx")
  end
end
