class ReviewOutputParser
  ReviewItem = Struct.new(:severity, :file, :lines, :comment, :suggested_fix, keyword_init: true)

  JSON_BLOCK_REGEX = /```json\s*\n(.*?)\n```/m

  def self.parse(output)
    new(output).parse
  end

  def initialize(output)
    @output = output.to_s
  end

  def parse
    json_content = extract_json_block
    return [] if json_content.nil?

    parse_json(json_content)
  rescue JSON::ParserError => e
    Rails.logger.warn("ReviewOutputParser: Failed to parse JSON: #{e.message}")
    []
  end

  private

  def extract_json_block
    match = @output.match(JSON_BLOCK_REGEX)
    return nil unless match

    match[1].strip
  end

  def parse_json(json_string)
    data = JSON.parse(json_string)
    return [] unless data.is_a?(Array)

    data.filter_map do |item|
      next unless item.is_a?(Hash)

      ReviewItem.new(
        severity: normalize_severity(item["severity"]),
        file: item["file"].to_s,
        lines: item["lines"]&.to_s,
        comment: item["comment"].to_s,
        suggested_fix: item["suggested_fix"].to_s
      )
    end
  end

  def normalize_severity(severity)
    case severity.to_s.downcase
    when "error", "critical", "bug"
      :error
    when "warning", "issue", "concern"
      :warning
    else
      :info
    end
  end
end
