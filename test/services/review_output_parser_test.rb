require "test_helper"

class ReviewOutputParserTest < ActiveSupport::TestCase
  setup do
    @parser_class = ReviewOutputParser
  end

  test "extracts JSON block from output" do
    output = <<~OUTPUT
      Some text before
      ```json
      [{"severity": "error", "file": "test.rb", "lines": "10", "comment": "Fix this"}]
      ```
      Some text after
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 1, result.size
    assert_equal :error, result.first.severity
    assert_equal "test.rb", result.first.file
    assert_equal "10", result.first.lines
    assert_equal "Fix this", result.first.comment
  end

  test "returns empty array when no JSON block present" do
    output = "Just some plain text without any JSON"

    result = @parser_class.parse(output)

    assert_equal [], result
  end

  test "returns empty array for nil input" do
    result = @parser_class.parse(nil)

    assert_equal [], result
  end

  test "returns empty array for empty string" do
    result = @parser_class.parse("")

    assert_equal [], result
  end

  test "handles invalid JSON gracefully" do
    output = <<~OUTPUT
      ```json
      {invalid json}
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal [], result
  end

  test "skips non-array JSON" do
    output = <<~OUTPUT
      ```json
      {"severity": "error", "file": "test.rb"}
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal [], result
  end

  test "filters non-hash items from array" do
    output = <<~OUTPUT
      ```json
      [
        {"severity": "error", "file": "test.rb", "lines": "10", "comment": "Fix this"},
        "string item",
        123,
        null,
        {"severity": "warning", "file": "other.rb", "lines": "5", "comment": "Check this"}
      ]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 2, result.size
    assert_equal "test.rb", result.first.file
    assert_equal "other.rb", result.last.file
  end

  test "normalizes severity: error, critical, bug to :error" do
    output = <<~OUTPUT
      ```json
      [
        {"severity": "error", "file": "a.rb", "lines": "1", "comment": "err"},
        {"severity": "critical", "file": "b.rb", "lines": "2", "comment": "crit"},
        {"severity": "bug", "file": "c.rb", "lines": "3", "comment": "bug"}
      ]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 3, result.size
    assert_equal :error, result[0].severity
    assert_equal :error, result[1].severity
    assert_equal :error, result[2].severity
  end

  test "normalizes severity: warning, issue, concern to :warning" do
    output = <<~OUTPUT
      ```json
      [
        {"severity": "warning", "file": "a.rb", "lines": "1", "comment": "warn"},
        {"severity": "issue", "file": "b.rb", "lines": "2", "comment": "issue"},
        {"severity": "concern", "file": "c.rb", "lines": "3", "comment": "concern"}
      ]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 3, result.size
    assert_equal :warning, result[0].severity
    assert_equal :warning, result[1].severity
    assert_equal :warning, result[2].severity
  end

  test "normalizes severity: unknown to :info" do
    output = <<~OUTPUT
      ```json
      [
        {"severity": "suggestion", "file": "a.rb", "lines": "1", "comment": "sugg"},
        {"severity": "info", "file": "b.rb", "lines": "2", "comment": "info"},
        {"severity": "unknown", "file": "c.rb", "lines": "3", "comment": "unk"},
        {"severity": "", "file": "d.rb", "lines": "4", "comment": "blank"}
      ]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 4, result.size
    result.each do |item|
      assert_equal :info, item.severity
    end
  end

  test "handles case-insensitive severity" do
    output = <<~OUTPUT
      ```json
      [
        {"severity": "ERROR", "file": "a.rb", "lines": "1", "comment": "err"},
        {"severity": "Warning", "file": "b.rb", "lines": "2", "comment": "warn"},
        {"severity": "CrItIcAl", "file": "c.rb", "lines": "3", "comment": "crit"}
      ]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 3, result.size
    assert_equal :error, result[0].severity
    assert_equal :warning, result[1].severity
    assert_equal :error, result[2].severity
  end

  test "includes suggested_fix in ReviewItem" do
    output = <<~OUTPUT
      ```json
      [{
        "severity": "error",
        "file": "test.rb",
        "lines": "10",
        "comment": "Fix this",
        "suggested_fix": "def fixed_method; end"
      }]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal "def fixed_method; end", result.first.suggested_fix
  end

  test "handles missing optional fields" do
    output = <<~OUTPUT
      ```json
      [{
        "file": "test.rb",
        "comment": "Missing some fields"
      }]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 1, result.size
    assert_equal :info, result.first.severity
    assert_nil result.first.lines
    assert_equal "", result.first.suggested_fix
  end

  test "extracts JSON with whitespace around delimiters" do
    output = <<~OUTPUT
      Text
      ```json#{'   '}
      [{"severity": "error", "file": "test.rb"}]#{'   '}
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 1, result.size
    assert_equal :error, result.first.severity
  end

  test "handles JSON block with newlines inside JSON" do
    output = <<~OUTPUT
      ```json
      [
        {
          "severity": "error",
          "file": "test.rb",
          "lines": "10",
          "comment": "Multi\\nline comment"
        }
      ]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 1, result.size
    assert_equal "test.rb", result.first.file
  end

  test "class method parse works correctly" do
    output = <<~OUTPUT
      ```json
      [{"severity": "error", "file": "test.rb", "lines": "10", "comment": "Fix this"}]
      ```
    OUTPUT

    result = ReviewOutputParser.parse(output)

    assert_equal 1, result.size
    assert_equal :error, result.first.severity
  end

  test "instance method parse works correctly" do
    output = <<~OUTPUT
      ```json
      [{"severity": "warning", "file": "other.rb", "lines": "5", "comment": "Check"}]
      ```
    OUTPUT

    parser = ReviewOutputParser.new(output)
    result = parser.parse

    assert_equal 1, result.size
    assert_equal :warning, result.first.severity
  end

  test "handles multiple JSON blocks - extracts first one" do
    output = <<~OUTPUT
      ```json
      [{"severity": "error", "file": "first.rb", "comment": "first"}]
      ```
      Some text
      ```json
      [{"severity": "warning", "file": "second.rb", "comment": "second"}]
      ```
    OUTPUT

    result = @parser_class.parse(output)

    assert_equal 1, result.size
    assert_equal "first.rb", result.first.file
  end
end
