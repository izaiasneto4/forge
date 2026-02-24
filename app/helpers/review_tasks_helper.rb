module ReviewTasksHelper
  # SVG icons for CLI clients
  CLI_CLIENT_ICONS = {
    "claude" => '<svg class="w-3.5 h-3.5" viewBox="0 0 100 100" fill="#D97757"><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(0 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(30 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(60 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(90 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(120 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(150 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(180 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(210 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(240 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(270 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(300 50 50)"/><path d="M50 8 L53 42 L50 50 L47 42 Z" transform="rotate(330 50 50)"/><circle cx="50" cy="50" r="12"/></svg>',
    "codex" => '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>',
    "opencode" => '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h7v14H3V5zm2 2v10h3V7H5zm11-2h5v2h-5v4h3v2h-3v4h5v2h-7V5h2z"/></svg>'
  }.freeze

  def cli_client_icon(client, options = {})
    css_class = options[:class] || "w-3.5 h-3.5"
    icon_svg = CLI_CLIENT_ICONS[client.to_s.downcase]
    return "" unless icon_svg

    icon_svg.gsub('class="w-3.5 h-3.5"', "class=\"#{css_class}\"").html_safe
  end

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

  def severity_border_class(severity)
    case severity.to_s
    when "critical", "error" then "border-red-500"
    when "major", "warning" then "border-yellow-500"
    when "minor" then "border-blue-500"
    when "suggestion" then "border-green-500"
    when "nitpick" then "border-gray-400"
    else "border-gray-300"
    end
  end

  def severity_badge_class(severity)
    case severity.to_s
    when "critical" then "linear-badge-red"
    when "major" then "linear-badge-yellow"
    when "minor" then "linear-badge-blue"
    when "suggestion" then "linear-badge-green"
    when "nitpick" then "linear-badge-default"
    else "linear-badge-default"
    end
  end

  def status_badge_class(status)
    case status.to_s
    when "pending" then "linear-badge-yellow"
    when "addressed" then "linear-badge-green"
    when "dismissed" then "linear-badge-default"
    else "linear-badge-default"
    end
  end

  def state_badge_class(state)
    case state
    when "pending_review" then "bg-gray-200 text-gray-700"
    when "in_review" then "bg-yellow-200 text-yellow-800"
    when "reviewed" then "bg-blue-200 text-blue-800"
    when "waiting_implementation" then "bg-orange-200 text-orange-800"
    when "done" then "bg-green-200 text-green-800"
    else "bg-gray-200 text-gray-700"
    end
  end

  def log_type_class(log_type)
    case log_type
    when "error" then "text-red-400"
    when "status" then "text-[color:var(--color-accent)] font-medium"
    else "text-[color:var(--color-text-secondary)]"
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

    language ||= detect_language(code)
    formatter = ::Rouge::Formatters::HTML.new
    lexer = ::Rouge::Lexer.find_fancy(language, code) || ::Rouge::Lexers::PlainText.new

    highlighted = formatter.format(lexer.lex(code))
    %(<div class="code-block relative group">
      <div class="flex items-center justify-between bg-gray-800 px-4 py-2 rounded-t-lg">
        <span class="text-gray-400 text-xs font-mono">#{language}</span>
        <button type="button" class="copy-btn text-gray-400 hover:text-white text-xs flex items-center gap-1" data-controller="copy" data-action="click->copy#copy" data-copy-content-value="#{ERB::Util.html_escape(code)}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
          Copy
        </button>
      </div>
      <pre class="highlight bg-gray-900 text-gray-100 p-4 rounded-b-lg overflow-x-auto text-sm m-0"><code class="language-#{language}">#{highlighted}</code></pre>
    </div>).html_safe
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
        language ||= "plaintext"
        formatter = ::Rouge::Formatters::HTML.new
        lexer = ::Rouge::Lexer.find_fancy(language, code) || ::Rouge::Lexers::PlainText.new

        highlighted = formatter.format(lexer.lex(code))
        %(<div class="code-block relative group my-4">
          <div class="flex items-center justify-between bg-gray-800 px-4 py-2 rounded-t-lg">
            <span class="text-gray-400 text-xs font-mono">#{language}</span>
            <button type="button" class="copy-btn text-gray-400 hover:text-white text-xs flex items-center gap-1" data-controller="copy" data-action="click->copy#copy" data-copy-content-value="#{ERB::Util.html_escape(code)}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
              Copy
            </button>
          </div>
          <pre class="highlight bg-gray-900 text-gray-100 p-4 rounded-b-lg overflow-x-auto text-sm m-0"><code class="language-#{language}">#{highlighted}</code></pre>
        </div>)
      end
    end
  end
end
