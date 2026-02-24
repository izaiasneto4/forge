class ReviewCommentBuilder
  class Error < StandardError; end

  # Maps ReviewOutputParser severity symbols to ReviewComment severity strings
  SEVERITY_MAP = {
    error: "critical",
    warning: "major",
    info: "suggestion"
  }.freeze
  CODE_SUGGESTION_REGEX = /
    ^\s*(def|class|module|function|const|let|var|if|for|while|switch|return|import|export|async|await|try|catch|raise|rescue|begin|end)\b|
    =>|==|!=|<=|>=|\+\+|--|\|\||&&|::|
    ^\s*[@$]?[a-zA-Z_]\w*\s*[:=]\s*.+|
    [{};]|
    ^\s*<\/?[a-zA-Z][^>]*>\s*$
  /x.freeze

  def self.persist_for_review_task(review_task)
    new(review_task).persist_all
  end

  def initialize(review_task)
    @review_task = review_task
  end

  def persist_all
    items = @review_task.parsed_review_items
    return [] if items.blank?

    create_comments_from_items(items)
  end

  private

  def create_comments_from_items(items)
    created_comments = []

    ActiveRecord::Base.transaction do
      items.each do |item|
        comment = create_review_comment(item)
        created_comments << comment
      end
    end

    Rails.logger.info("ReviewCommentBuilder: Created #{created_comments.size} comments for ReviewTask ##{@review_task.id}")
    created_comments
  rescue ActiveRecord::RecordInvalid => e
    Rails.logger.error("ReviewCommentBuilder: Failed to create comments: #{e.message}")
    raise Error, "Cannot persist review comments: #{e.message}"
  end

  def create_review_comment(item)
    @review_task.review_comments.create!(
      title: item.title,
      file_path: item.file,
      line_number: parse_line_number(item.lines),
      severity: map_severity(item.severity),
      body: build_comment_body(item),
      status: "pending"
    )
  end

  def parse_line_number(lines_str)
    return nil if lines_str.blank?

    # Handle both "10" and "10-20" formats, extract the starting line
    lines_str.to_s.split("-").first.to_i.presence
  end

  def map_severity(parsed_severity)
    SEVERITY_MAP[parsed_severity] || "suggestion"
  end

  def build_comment_body(item)
    body = item.comment.to_s

    if item.suggested_fix.present?
      suggestion = item.suggested_fix.to_s.strip
      return body if suggestion.blank?

      if code_suggestion?(suggestion)
        language = detect_language_from_file(item.file)
        code_block = "**Suggested fix:**\n```#{language}\n#{suggestion}\n```"
        body = body.present? ? "#{body}\n\n#{code_block}" : code_block
      else
        body = [ body, suggestion ].reject(&:blank?).join("\n\n")
      end
    end

    body
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

  def detect_language_from_file(filename)
    return "" if filename.blank? || filename == "N/A"

    ext = File.extname(filename).downcase.delete(".")
    EXTENSION_LANGUAGE_MAP[ext] || ""
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
    "php" => "php",
    "sh" => "bash",
    "yml" => "yaml",
    "yaml" => "yaml",
    "json" => "json",
    "sql" => "sql"
  }.freeze
end
