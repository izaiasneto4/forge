require "test_helper"
require "ostruct"

class ReviewCommentBuilderTest < ActiveSupport::TestCase
  setup do
    @pull_request = PullRequest.create!(
      github_id: 123,
      number: 456,
      title: "Test PR",
      description: "Test description",
      url: "https://github.com/test/repo/pull/456",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )
    @review_task = ReviewTask.create!(
      pull_request: @pull_request,
      state: "pending_review",
      cli_client: "claude",
      review_type: "review"
    )
    @builder = ReviewCommentBuilder.new(@review_task)
  end

  test "persist_all returns empty array when no items" do
    mock_review_task = OpenStruct.new(parsed_review_items: [])
    builder = ReviewCommentBuilder.new(mock_review_task)
    result = builder.persist_all
    assert_equal [], result
  end

  test "persist_all returns empty array when items is nil" do
    mock_review_task = OpenStruct.new(parsed_review_items: nil)
    builder = ReviewCommentBuilder.new(mock_review_task)
    result = builder.persist_all
    assert_equal [], result
  end

  test "persist_all creates comments from items" do
    item1 = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "Fix this bug",
      suggested_fix: "fixed code"
    )
    item2 = ReviewOutputParser::ReviewItem.new(
      severity: :warning,
      file: "other.rb",
      lines: "20-30",
      comment: "Refactor this",
      suggested_fix: nil
    )

    mock_review_task = OpenStruct.new(
      parsed_review_items: [ item1, item2 ],
      review_comments: @review_task.review_comments
    )
    builder = ReviewCommentBuilder.new(mock_review_task)
    result = builder.persist_all

    assert_equal 2, result.size
    assert_equal "test.rb", result[0].file_path
    assert_equal 10, result[0].line_number
    assert_equal "critical", result[0].severity
    assert_equal "other.rb", result[1].file_path
    assert_equal 20, result[1].line_number
    assert_equal "major", result[1].severity

    ReviewComment.where(review_task_id: @review_task.id).destroy_all
  end

  test "persist_all raises Error on validation failure" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "",
      suggested_fix: nil
    )

    mock_review_task = OpenStruct.new(
      parsed_review_items: [ item ],
      review_comments: @review_task.review_comments
    )
    builder = ReviewCommentBuilder.new(mock_review_task)

    assert_raises(ReviewCommentBuilder::Error) do
      builder.persist_all
    end
  end

  test "parse_line_number handles nil" do
    result = @builder.send(:parse_line_number, nil)

    assert_nil result
  end

  test "parse_line_number handles empty string" do
    result = @builder.send(:parse_line_number, "")

    assert_nil result
  end

  test "parse_line_number handles whitespace" do
    result = @builder.send(:parse_line_number, "   ")

    assert_nil result
  end

  test "parse_line_number extracts number from single line" do
    result = @builder.send(:parse_line_number, "10")

    assert_equal 10, result
  end

  test "parse_line_number extracts start from range" do
    result = @builder.send(:parse_line_number, "10-20")

    assert_equal 10, result
  end

  test "parse_line_number handles large range" do
    result = @builder.send(:parse_line_number, "100-200")

    assert_equal 100, result
  end

  test "parse_line_number converts to integer" do
    result = @builder.send(:parse_line_number, "42")

    assert_equal 42, result
    assert_kind_of Integer, result
  end

  test "map_severity maps error to critical" do
    result = @builder.send(:map_severity, :error)

    assert_equal "critical", result
  end

  test "map_severity maps warning to major" do
    result = @builder.send(:map_severity, :warning)

    assert_equal "major", result
  end

  test "map_severity maps info to suggestion" do
    result = @builder.send(:map_severity, :info)

    assert_equal "suggestion", result
  end

  test "map_severity defaults to suggestion for unknown severity" do
    result = @builder.send(:map_severity, :unknown)

    assert_equal "suggestion", result
  end

  test "map_severity defaults to suggestion for nil" do
    result = @builder.send(:map_severity, nil)

    assert_equal "suggestion", result
  end

  test "build_comment_body includes comment" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "This is a comment",
      suggested_fix: nil
    )

    result = @builder.send(:build_comment_body, item)

    assert_equal "This is a comment", result
  end

  test "build_comment_body appends suggested_fix when present" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "This is a comment",
      suggested_fix: "fixed code"
    )

    result = @builder.send(:build_comment_body, item)

    assert_includes result, "This is a comment"
    assert_includes result, "**Suggested fix:**"
    assert_includes result, "```"
    assert_includes result, "fixed code"
  end

  test "build_comment_body handles multi-line suggested_fix" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "Fix this",
      suggested_fix: "line 1\nline 2\nline 3"
    )

    result = @builder.send(:build_comment_body, item)

    assert_includes result, "line 1\nline 2\nline 3"
  end

  test "build_comment_body handles empty comment" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "",
      suggested_fix: nil
    )

    result = @builder.send(:build_comment_body, item)

    assert_equal "", result
  end

  test "build_comment_body handles nil comment" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: nil,
      suggested_fix: nil
    )

    result = @builder.send(:build_comment_body, item)

    assert_equal "", result
  end

  test "build_comment_body handles empty suggested_fix" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "Fix this",
      suggested_fix: ""
    )

    result = @builder.send(:build_comment_body, item)

    assert_includes result, "Fix this"
    refute_includes result, "**Suggested fix:**"
  end

  test "build_comment_body handles nil suggested_fix" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "Fix this",
      suggested_fix: nil
    )

    result = @builder.send(:build_comment_body, item)

    assert_includes result, "Fix this"
    refute_includes result, "**Suggested fix:**"
  end

  test "create_review_comment calls create! with correct attributes" do
    item = ReviewOutputParser::ReviewItem.new(
      severity: :error,
      file: "test.rb",
      lines: "10",
      comment: "Fix this",
      suggested_fix: "fix code"
    )

    result = @builder.send(:create_review_comment, item)

    assert_equal "test.rb", result.file_path
    assert_equal 10, result.line_number
    assert_equal "critical", result.severity
    assert_equal "Fix this\n\n**Suggested fix:**\n```ruby\nfix code\n```", result.body
    assert_equal "pending", result.status

    ReviewComment.where(review_task_id: @review_task.id).destroy_all
  end

  test "persist_for_review_task class method" do
    mock_review_task = OpenStruct.new(id: 1, parsed_review_items: [], review_comments: OpenStruct.new)
    builder = ReviewCommentBuilder.new(mock_review_task)

    result = builder.persist_all

    assert_equal [], result
  end

  test "persist_all handles multiple items" do
    items = Array.new(5) do |i|
      ReviewOutputParser::ReviewItem.new(
        severity: :error,
        file: "file#{i}.rb",
        lines: "#{i}",
        comment: "Comment #{i}",
        suggested_fix: nil
      )
    end

    mock_review_task = OpenStruct.new(
      parsed_review_items: items,
      review_comments: @review_task.review_comments
    )
    builder = ReviewCommentBuilder.new(mock_review_task)
    result = builder.persist_all
    assert_equal 5, result.size
    5.times do |i|
      assert_equal "file#{i}.rb", result[i].file_path
      assert_equal i, result[i].line_number
      assert_equal "Comment #{i}", result[i].body
    end

    ReviewComment.where(review_task_id: @review_task.id).destroy_all
  end
end
