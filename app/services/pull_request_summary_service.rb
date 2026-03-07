require "json"
require "open3"
require "securerandom"
require "tmpdir"

class PullRequestSummaryService
  class Error < StandardError; end

  JSON_BLOCK_REGEX = /```json\s*\n(.*?)\n```/m
  MAX_CHUNK_CHARS = 12_000
  MAX_ITEMS_PER_LIST = 5

  def initialize(snapshot:, cli_client: nil)
    @snapshot = snapshot
    @pull_request = snapshot.pull_request
    @cli_client = cli_client.presence || Setting.default_cli_client
  end

  def generate!
    diff = fetch_diff
    raise Error, "PR diff is empty" if diff.blank?

    chunk_results = chunk_diff(diff).map.with_index do |chunk, index|
      analyze_chunk(chunk, index: index + 1)
    end

    summary = consolidate(chunk_results)
    @snapshot.store_ai_summary!(summary)
    summary
  rescue => e
    @snapshot.mark_ai_summary_failed!(e.message)
    raise
  end

  private

  def fetch_diff
    stdout, stderr, status = Open3.capture3(
      "gh", "pr", "diff", @pull_request.number.to_s,
      "--repo", @pull_request.repo_full_name
    )

    raise Error, stderr.presence || stdout.presence || "Failed to fetch PR diff" unless status.success?

    stdout
  end

  def chunk_diff(diff)
    chunks = []
    current_chunk = +""

    diff.each_line do |line|
      if current_chunk.length + line.length > MAX_CHUNK_CHARS && current_chunk.present?
        chunks << current_chunk
        current_chunk = +""
      end

      current_chunk << line
    end

    chunks << current_chunk if current_chunk.present?
    chunks
  end

  def analyze_chunk(chunk, index:)
    prompt = <<~PROMPT
      You are analyzing a GitHub pull request diff chunk.

      Return only a JSON object wrapped in ```json fences with this exact shape:
      {
        "main_changes": ["short phrase"],
        "risk_areas": ["short phrase"]
      }

      Rules:
      - Be concise.
      - `main_changes` should list concrete code changes from this diff chunk.
      - `risk_areas` should list areas where bugs/regressions are most likely.
      - Return at most #{MAX_ITEMS_PER_LIST} items for each array.
      - If a list has no items, return an empty array.

      Pull request: ##{@pull_request.number} #{@pull_request.title}
      Chunk: #{index}

      ```diff
      #{chunk}
      ```
    PROMPT

    normalize_chunk_result(parse_json_object(run_ai_prompt(prompt)))
  end

  def consolidate(chunk_results)
    prompt = <<~PROMPT
      Consolidate these per-chunk pull request notes into one reviewer-facing summary.

      Return only a JSON object wrapped in ```json fences with this exact shape:
      {
        "files_changed": #{files_changed_value || 0},
        "lines_added": #{lines_added_value || 0},
        "lines_removed": #{lines_removed_value || 0},
        "main_changes": ["short phrase"],
        "risk_areas": ["short phrase"]
      }

      Rules:
      - Prefer the provided metrics unless they are null.
      - `main_changes` must contain at least 1 item.
      - `risk_areas` can be empty.
      - Deduplicate repeated points.
      - Keep each item short and reviewer-oriented.
      - Return at most #{MAX_ITEMS_PER_LIST} items per array.

      Canonical metrics:
      - files_changed: #{files_changed_value.inspect}
      - lines_added: #{lines_added_value.inspect}
      - lines_removed: #{lines_removed_value.inspect}

      Chunk analysis:
      ```json
      #{JSON.pretty_generate(chunk_results)}
      ```
    PROMPT

    normalize_final_summary(parse_json_object(run_ai_prompt(prompt)))
  end

  def normalize_chunk_result(data)
    {
      "main_changes" => normalize_string_array(data["main_changes"]),
      "risk_areas" => normalize_string_array(data["risk_areas"])
    }
  end

  def normalize_final_summary(data)
    summary = {
      files_changed: files_changed_value || integer_or_nil(data["files_changed"]),
      lines_added: lines_added_value || integer_or_nil(data["lines_added"]),
      lines_removed: lines_removed_value || integer_or_nil(data["lines_removed"]),
      main_changes: normalize_string_array(data["main_changes"]),
      risk_areas: normalize_string_array(data["risk_areas"])
    }

    raise Error, "Summary output missing main changes" if summary[:main_changes].empty?

    summary
  end

  def normalize_string_array(value)
    Array(value)
      .map { |item| item.to_s.strip }
      .reject(&:blank?)
      .uniq
      .first(MAX_ITEMS_PER_LIST)
  end

  def integer_or_nil(value)
    Integer(value, exception: false)
  end

  def files_changed_value
    @pull_request.changed_files
  end

  def lines_added_value
    @pull_request.additions
  end

  def lines_removed_value
    @pull_request.deletions
  end

  def run_ai_prompt(prompt)
    if @cli_client == "codex"
      output_path = File.join(Dir.tmpdir, "forge-pr-summary-#{SecureRandom.hex(6)}.md")
      stdout, stderr, status = Open3.capture3("codex", "exec", "--output-last-message", output_path, prompt)
      content = File.exist?(output_path) ? File.read(output_path) : stdout
      File.delete(output_path) if File.exist?(output_path)
      raise Error, stderr.presence || stdout.presence || "AI summary command failed" unless status.success? || content.present?
      return content
    end

    stdout, stderr, status =
      case @cli_client
      when "opencode"
        Open3.capture3("opencode", "run", prompt)
      else
        Open3.capture3("claude", "-p", prompt)
      end

    raise Error, stderr.presence || stdout.presence || "AI summary command failed" unless status.success? && stdout.present?

    stdout
  end

  def parse_json_object(text)
    content = text.to_s
    fenced = content.match(JSON_BLOCK_REGEX)&.captures&.first
    parsed = JSON.parse((fenced || content).strip)
    raise Error, "AI summary output must be a JSON object" unless parsed.is_a?(Hash)

    parsed
  rescue JSON::ParserError => e
    raise Error, "AI summary output parse failed: #{e.message}"
  end
end
