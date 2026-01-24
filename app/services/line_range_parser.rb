# Parses GitHub-style line range strings into structured data
#
# Supported formats:
#   - "10"     -> single line comment
#   - "10-20"  -> multi-line comment (start to end)
#   - "#L10"   -> GitHub URL fragment format (single line)
#   - "#L10-L20" -> GitHub URL fragment format (range)
#
# The GitHub API requires:
#   - Single line: { line: 10, side: "RIGHT" }
#   - Multi-line: { start_line: 10, line: 20, side: "RIGHT" }
#
class LineRangeParser
  # Immutable result object representing a parsed line range
  LineRange = Struct.new(:start_line, :end_line, :single_line?, keyword_init: true) do
    def valid?
      start_line.present? && end_line.present? &&
        start_line.positive? && end_line.positive? &&
        start_line <= end_line
    end

    # Returns the line range as a GitHub API payload fragment
    # @return [Hash] with :line and optionally :start_line keys
    def to_github_payload
      return {} unless valid?

      payload = { line: end_line, side: "RIGHT" }
      payload[:start_line] = start_line unless single_line?
      payload
    end

    # Returns a human-readable string representation
    def to_s
      return "" unless valid?
      single_line? ? start_line.to_s : "#{start_line}-#{end_line}"
    end
  end

  # Parses a line range string into a LineRange object
  #
  # @param line_str [String, nil] The line range string to parse
  # @return [LineRange, nil] The parsed line range, or nil if invalid/empty
  #
  # @example Parse single line
  #   LineRangeParser.parse("10")
  #   # => #<LineRange start_line=10, end_line=10, single_line?=true>
  #
  # @example Parse line range
  #   LineRangeParser.parse("10-20")
  #   # => #<LineRange start_line=10, end_line=20, single_line?=false>
  #
  # @example Parse GitHub URL fragment
  #   LineRangeParser.parse("#L10-L20")
  #   # => #<LineRange start_line=10, end_line=20, single_line?=false>
  #
  def self.parse(line_str)
    new.parse(line_str)
  end

  # Instance method for parsing (allows for future configuration)
  def parse(line_str)
    return nil if line_str.blank?

    normalized = normalize_input(line_str.to_s.strip)
    return nil if normalized.blank?

    if range_format?(normalized)
      parse_range(normalized)
    else
      parse_single_line(normalized)
    end
  end

  private

  # Normalizes various input formats to a standard "N" or "N-M" format
  #
  # Handles:
  #   - "#L10" -> "10"
  #   - "#L10-L20" -> "10-20"
  #   - "L10-L20" -> "10-20"
  #   - "10-20" -> "10-20" (unchanged)
  #   - "10" -> "10" (unchanged)
  #
  def normalize_input(input)
    normalized = input.dup

    # Remove leading hash (from URL fragments)
    normalized = normalized.delete_prefix("#")

    # Remove 'L' prefixes (GitHub line number format)
    normalized = normalized.gsub(/L(\d+)/i, '\1')

    normalized.strip
  end

  # Checks if the input is in range format (contains a hyphen between numbers)
  def range_format?(input)
    input.include?("-") && input.match?(/\A\d+-\d+\z/)
  end

  # Parses a range format string like "10-20"
  def parse_range(input)
    parts = input.split("-", 2)
    return nil unless parts.size == 2

    start_line = parse_integer(parts[0])
    end_line = parse_integer(parts[1])

    return nil unless start_line && end_line

    # Normalize reversed ranges (e.g., "20-10" becomes "10-20")
    start_line, end_line = [ start_line, end_line ].sort

    LineRange.new(
      start_line: start_line,
      end_line: end_line,
      single_line?: false
    )
  end

  # Parses a single line number string like "10"
  def parse_single_line(input)
    line = parse_integer(input)
    return nil unless line

    LineRange.new(
      start_line: line,
      end_line: line,
      single_line?: true
    )
  end

  # Safely parses a string to a positive integer
  # @return [Integer, nil] The parsed integer or nil if invalid
  def parse_integer(str)
    return nil if str.blank?

    cleaned = str.to_s.strip
    return nil unless cleaned.match?(/\A\d+\z/)

    value = cleaned.to_i
    value.positive? ? value : nil
  end
end
