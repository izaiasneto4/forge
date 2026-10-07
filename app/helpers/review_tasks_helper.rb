module ReviewTasksHelper
  EXTENSION_LANGUAGE_MAP = {
    "rb" => "ruby",
    "js" => "javascript",
    "ts" => "typescript",
    "tsx" => "typescript",
    "jsx" => "javascript",
    "py" => "python",
    "go" => "go",
    "rs" => "rust",
    "java" => "java",
    "kt" => "kotlin",
    "swift" => "swift",
    "cs" => "csharp",
    "cpp" => "cpp",
    "c" => "c",
    "h" => "c",
    "hpp" => "cpp",
    "php" => "php",
    "sh" => "bash",
    "bash" => "bash",
    "zsh" => "bash",
    "yml" => "yaml",
    "yaml" => "yaml",
    "json" => "json",
    "md" => "markdown",
    "html" => "html",
    "erb" => "erb",
    "css" => "css",
    "scss" => "scss",
    "sass" => "sass",
    "sql" => "sql",
    "ex" => "elixir",
    "exs" => "elixir"
  }.freeze
  CODE_SUGGESTION_REGEX = /
    ^\s*(def|class|module|function|const|let|var|if|for|while|switch|return|import|export|async|await|try|catch|raise|rescue|begin|end)\b|
    =>|==|!=|<=|>=|\+\+|--|\|\||&&|::|
    ^\s*[@$]?[a-zA-Z_]\w*\s*[:=]\s*.+|
    [{};]|
    ^\s*<\/?[a-zA-Z][^>]*>\s*$
  /x.freeze

  def severity_emoji(severity)
    case severity.to_s
    when "critical", "error" then "🚨"
    when "major", "warning" then "⚠️"
    when "minor" then "ℹ️"
    when "suggestion" then "💡"
    when "nitpick" then "🔍"
    else "💬"
    end
  end

  def format_review_duration(started_at, completed_at)
    return nil unless started_at && completed_at

    seconds = (completed_at - started_at).to_i
    if seconds < 60
      "#{seconds}s"
    elsif seconds < 3600
      minutes = seconds / 60
      secs = seconds % 60
      secs > 0 ? "#{minutes}m #{secs}s" : "#{minutes}m"
    else
      hours = seconds / 3600
      minutes = (seconds % 3600) / 60
      minutes > 0 ? "#{hours}h #{minutes}m" : "#{hours}h"
    end
  end

  def render_markdown(text)
    return "" if text.blank?

    renderer = rouge_html_renderer.new(hard_wrap: true)
    markdown = ::Redcarpet::Markdown.new(renderer,
      fenced_code_blocks: true,
      autolink: true,
      tables: true,
      strikethrough: true,
      lax_spacing: true,
      space_after_headers: true,
      no_intra_emphasis: true
    )
    markdown.render(text).html_safe
  end

  def render_code_block(code, language = nil)
    return "" if code.blank?

    ReviewTasksHelper.code_block_html(code, language || detect_language(code)).html_safe
  end

  # Shared by fenced markdown blocks and standalone suggestions. The frontend
  # wires up .copy-btn using data-copy.
  def self.code_block_html(code, language)
    lexer = ::Rouge::Lexer.find_fancy(language, code) || ::Rouge::Lexers::PlainText.new
    highlighted = ::Rouge::Formatters::HTML.new.format(lexer.lex(code))
    label = ERB::Util.html_escape(language)

    %(<div class="code-block"><div class="code-head"><span>#{label}</span>) +
      %(<button type="button" class="copy-btn" data-copy="#{ERB::Util.html_escape(code)}">Copy</button></div>) +
      %(<pre class="highlight"><code class="language-#{label}">#{highlighted}</code></pre></div>)
  end

  def detect_language_from_file(filename)
    return nil if filename.blank?

    ext = File.extname(filename).downcase.delete(".")
    EXTENSION_LANGUAGE_MAP[ext] || ext
  end

  def code_suggestion?(suggestion)
    return false if suggestion.blank?
    return true if suggestion.include?("```")

    lines = suggestion.lines.map(&:strip).reject(&:blank?)
    return false if lines.empty?

    return true if lines.any? { |line| line.match?(CODE_SUGGESTION_REGEX) }
    return true if lines.one? && lines.first.match?(/^[\w.$]+\([^)]*\)$/)

    false
  end

  private

  def detect_language(code)
    return "ruby" if code.include?("def ") || code.include?("class ")
    return "javascript" if code.include?("const ") || code.include?("function ")
    return "typescript" if code.include?(": string") || code.include?(": number")
    return "python" if code.include?("def ") && code.include?(":")
    "plaintext"
  end

  def rouge_html_renderer
    @rouge_html_renderer ||= Class.new(::Redcarpet::Render::HTML) do
      def block_code(code, language)
        ReviewTasksHelper.code_block_html(code, language.presence || "plaintext")
      end
    end
  end
end
