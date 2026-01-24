require "test_helper"

class LineRangeParserTest < ActiveSupport::TestCase
  # Single line parsing tests
  test "parses single line number" do
    result = LineRangeParser.parse("10")

    assert result.valid?
    assert_equal 10, result.start_line
    assert_equal 10, result.end_line
    assert result.single_line?
  end

  test "parses single line with whitespace" do
    result = LineRangeParser.parse("  15  ")

    assert result.valid?
    assert_equal 15, result.start_line
    assert result.single_line?
  end

  # Line range parsing tests
  test "parses line range" do
    result = LineRangeParser.parse("10-20")

    assert result.valid?
    assert_equal 10, result.start_line
    assert_equal 20, result.end_line
    refute result.single_line?
  end

  test "normalizes reversed line range" do
    result = LineRangeParser.parse("20-10")

    assert result.valid?
    assert_equal 10, result.start_line
    assert_equal 20, result.end_line
    refute result.single_line?
  end

  # GitHub URL fragment format tests
  test "parses GitHub URL fragment single line format" do
    result = LineRangeParser.parse("#L15")

    assert result.valid?
    assert_equal 15, result.start_line
    assert_equal 15, result.end_line
    assert result.single_line?
  end

  test "parses GitHub URL fragment range format" do
    result = LineRangeParser.parse("#L10-L25")

    assert result.valid?
    assert_equal 10, result.start_line
    assert_equal 25, result.end_line
    refute result.single_line?
  end

  test "parses L prefix without hash" do
    result = LineRangeParser.parse("L5-L15")

    assert result.valid?
    assert_equal 5, result.start_line
    assert_equal 15, result.end_line
  end

  test "parses lowercase L prefix" do
    result = LineRangeParser.parse("#l10-l20")

    assert result.valid?
    assert_equal 10, result.start_line
    assert_equal 20, result.end_line
  end

  # Invalid input tests
  test "returns nil for nil input" do
    assert_nil LineRangeParser.parse(nil)
  end

  test "returns nil for empty string" do
    assert_nil LineRangeParser.parse("")
  end

  test "returns nil for whitespace only" do
    assert_nil LineRangeParser.parse("   ")
  end

  test "returns nil for non-numeric input" do
    assert_nil LineRangeParser.parse("abc")
    assert_nil LineRangeParser.parse("line10")
    assert_nil LineRangeParser.parse("10abc")
  end

  test "returns nil for zero" do
    assert_nil LineRangeParser.parse("0")
  end

  test "returns nil for negative numbers" do
    assert_nil LineRangeParser.parse("-5")
  end

  test "returns nil for invalid range format" do
    assert_nil LineRangeParser.parse("10-")
    assert_nil LineRangeParser.parse("-20")
    assert_nil LineRangeParser.parse("10-abc")
  end

  # GitHub payload generation tests
  test "generates correct GitHub payload for single line" do
    result = LineRangeParser.parse("10")
    payload = result.to_github_payload

    assert_equal({ line: 10, side: "RIGHT" }, payload)
    assert_nil payload[:start_line]
  end

  test "generates correct GitHub payload for line range" do
    result = LineRangeParser.parse("10-20")
    payload = result.to_github_payload

    assert_equal 20, payload[:line]
    assert_equal 10, payload[:start_line]
    assert_equal "RIGHT", payload[:side]
  end

  # String representation tests
  test "to_s returns single line number" do
    result = LineRangeParser.parse("10")
    assert_equal "10", result.to_s
  end

  test "to_s returns line range" do
    result = LineRangeParser.parse("10-20")
    assert_equal "10-20", result.to_s
  end

  # Validation tests
  test "valid? returns true for valid single line" do
    result = LineRangeParser.parse("10")
    assert result.valid?
  end

  test "valid? returns true for valid range" do
    result = LineRangeParser.parse("10-20")
    assert result.valid?
  end

  # Class method vs instance method
  test "class method parse works correctly" do
    result = LineRangeParser.parse("10-20")
    assert_equal 10, result.start_line
    assert_equal 20, result.end_line
  end

  test "instance method parse works correctly" do
    parser = LineRangeParser.new
    result = parser.parse("10-20")
    assert_equal 10, result.start_line
    assert_equal 20, result.end_line
  end
end
