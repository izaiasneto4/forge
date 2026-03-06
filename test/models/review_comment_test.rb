require "test_helper"

class ReviewCommentTest < ActiveSupport::TestCase
  setup do
    @pr = PullRequest.create!(
      github_id: 123,
      number: 42,
      title: "Test PR",
      url: "https://github.com/test/repo/pull/42",
      repo_owner: "test",
      repo_name: "repo",
      review_status: "pending_review"
    )

    @task = ReviewTask.create!(
      pull_request: @pr,
      state: "reviewed",
      cli_client: "claude",
      review_type: "review"
    )

    @comment = ReviewComment.new(
      review_task: @task,
      file_path: "app/models/test.rb",
      line_number: 10,
      body: "Test comment",
      severity: "minor",
      status: "pending"
    )
  end

  # Validations
  test "valid with all required fields" do
    assert @comment.valid?
  end

  test "invalid without file_path" do
    @comment.file_path = nil
    refute @comment.valid?
    assert_includes @comment.errors[:file_path], "can't be blank"
  end

  test "invalid without body" do
    @comment.body = nil
    refute @comment.valid?
    assert_includes @comment.errors[:body], "can't be blank"
  end

  test "invalid with invalid severity" do
    @comment.severity = "invalid_severity"
    refute @comment.valid?
    assert_includes @comment.errors[:severity], "is not included in the list"
  end

  test "invalid with invalid status" do
    @comment.status = "invalid_status"
    refute @comment.valid?
    assert_includes @comment.errors[:status], "is not included in the list"
  end

  test "valid with all allowed severities" do
    ReviewComment::SEVERITIES.each do |severity|
      @comment.severity = severity
      assert @comment.valid?, "Severity #{severity} should be valid"
    end
  end

  test "valid with all allowed statuses" do
    ReviewComment::STATUSES.each do |status|
      @comment.status = status
      assert @comment.valid?, "Status #{status} should be valid"
    end
  end

  # Scopes
  test "pending scope returns only pending comments" do
    @comment.save!
    addressed = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Addressed",
      severity: "minor",
      status: "addressed"
    )

    assert_equal [ @comment ], ReviewComment.pending.to_a
  end

  test "addressed scope returns only addressed comments" do
    @comment.update!(status: "addressed")
    @comment.save!
    pending = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Pending",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.addressed.to_a
  end

  test "dismissed scope returns only dismissed comments" do
    @comment.update!(status: "dismissed")
    @comment.save!
    pending = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Pending",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.dismissed.to_a
  end

  test "critical scope returns only critical comments" do
    @comment.update!(severity: "critical")
    @comment.save!
    minor = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Minor",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.critical.to_a
  end

  test "major scope returns only major comments" do
    @comment.update!(severity: "major")
    @comment.save!
    minor = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Minor",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.major.to_a
  end

  test "minor scope returns only minor comments" do
    @comment.save!
    critical = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Critical",
      severity: "critical",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.minor.to_a
  end

  test "suggestions scope returns only suggestion comments" do
    @comment.update!(severity: "suggestion")
    @comment.save!
    minor = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Minor",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.suggestions.to_a
  end

  test "nitpicks scope returns only nitpick comments" do
    @comment.update!(severity: "nitpick")
    @comment.save!
    minor = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Minor",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.nitpicks.to_a
  end

  test "actionable scope returns critical, major, and minor comments" do
    @comment.save!
    major = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Major",
      severity: "major",
      status: "pending"
    )
    critical = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Critical",
      severity: "critical",
      status: "pending"
    )
    suggestion = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Suggestion",
      severity: "suggestion",
      status: "pending"
    )

    actionable = ReviewComment.actionable.to_a.sort_by(&:id)
    assert_equal 3, actionable.length
    assert_includes actionable, @comment
    assert_includes actionable, major
    assert_includes actionable, critical
    refute_includes actionable, suggestion
  end

  test "for_file scope returns comments for specific file" do
    @comment.save!
    other = ReviewComment.create!(
      review_task: @task,
      file_path: "other.rb",
      body: "Other",
      severity: "minor",
      status: "pending"
    )

    assert_equal [ @comment ], ReviewComment.for_file("app/models/test.rb").to_a
  end

  test "by_severity scope orders by severity" do
    @comment.save!
    critical = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Critical",
      severity: "critical",
      status: "pending"
    )
    major = ReviewComment.create!(
      review_task: @task,
      file_path: "test.rb",
      body: "Major",
      severity: "major",
      status: "pending"
    )

    ordered = ReviewComment.by_severity.to_a
    assert_equal critical, ordered.first
    assert_equal major, ordered.second
    assert_equal @comment, ordered.third
  end

  # Predicates
  test "pending? returns true when status is pending" do
    @comment.status = "pending"
    assert @comment.pending?
  end

  test "pending? returns false when status is not pending" do
    @comment.status = "addressed"
    refute @comment.pending?
  end

  test "addressed? returns true when status is addressed" do
    @comment.status = "addressed"
    assert @comment.addressed?
  end

  test "addressed? returns false when status is not addressed" do
    @comment.status = "pending"
    refute @comment.addressed?
  end

  test "dismissed? returns true when status is dismissed" do
    @comment.status = "dismissed"
    assert @comment.dismissed?
  end

  test "dismissed? returns false when status is not dismissed" do
    @comment.status = "pending"
    refute @comment.dismissed?
  end

  test "critical? returns true when severity is critical" do
    @comment.severity = "critical"
    assert @comment.critical?
  end

  test "critical? returns false when severity is not critical" do
    @comment.severity = "minor"
    refute @comment.critical?
  end

  test "major? returns true when severity is major" do
    @comment.severity = "major"
    assert @comment.major?
  end

  test "major? returns false when severity is not major" do
    @comment.severity = "minor"
    refute @comment.major?
  end

  test "minor? returns true when severity is minor" do
    @comment.severity = "minor"
    assert @comment.minor?
  end

  test "minor? returns false when severity is not minor" do
    @comment.severity = "critical"
    refute @comment.minor?
  end

  test "suggestion? returns true when severity is suggestion" do
    @comment.severity = "suggestion"
    assert @comment.suggestion?
  end

  test "suggestion? returns false when severity is not suggestion" do
    @comment.severity = "minor"
    refute @comment.suggestion?
  end

  test "nitpick? returns true when severity is nitpick" do
    @comment.severity = "nitpick"
    assert @comment.nitpick?
  end

  test "nitpick? returns false when severity is not nitpick" do
    @comment.severity = "minor"
    refute @comment.nitpick?
  end

  test "actionable? returns true for critical severity" do
    @comment.severity = "critical"
    assert @comment.actionable?
  end

  test "actionable? returns true for major severity" do
    @comment.severity = "major"
    assert @comment.actionable?
  end

  test "actionable? returns true for minor severity" do
    @comment.severity = "minor"
    assert @comment.actionable?
  end

  test "actionable? returns false for suggestion severity" do
    @comment.severity = "suggestion"
    refute @comment.actionable?
  end

  test "actionable? returns false for nitpick severity" do
    @comment.severity = "nitpick"
    refute @comment.actionable?
  end

  # Methods
  test "mark_addressed! updates status to addressed" do
    @comment.save!
    @comment.mark_addressed!
    @comment.reload

    assert_equal "addressed", @comment.status
  end

  test "mark_addressed! saves resolution note" do
    @comment.save!
    @comment.mark_addressed!("Fixed it")
    @comment.reload

    assert_equal "Fixed it", @comment.resolution_note
  end

  test "mark_dismissed! updates status to dismissed" do
    @comment.save!
    @comment.mark_dismissed!
    @comment.reload

    assert_equal "dismissed", @comment.status
  end

  test "mark_dismissed! saves resolution note" do
    @comment.save!
    @comment.mark_dismissed!("Not applicable")
    @comment.reload

    assert_equal "Not applicable", @comment.resolution_note
  end

  test "location returns file_path with line_number when present" do
    @comment.file_path = "app/models/test.rb"
    @comment.line_number = 10
    assert_equal "app/models/test.rb:10", @comment.location
  end

  test "location returns file_path without line_number when absent" do
    @comment.file_path = "app/models/test.rb"
    @comment.line_number = nil
    assert_equal "app/models/test.rb", @comment.location
  end

  test "location returns file_path with line_number when line_number is zero" do
    @comment.file_path = "app/models/test.rb"
    @comment.line_number = 0
    assert_equal "app/models/test.rb:0", @comment.location
  end
end
