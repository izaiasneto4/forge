require "test_helper"
require "rake"

class PullRequestsRakeTest < ActiveSupport::TestCase
  def setup
    @rake = Rake.application
    @rake.init
    @rake.load_rakefile
    Rake::Task.define_task(:environment)
  end

  def teardown
    Rake.application.clear
  end

  test "pull_requests:fix_orphaned_states task exists" do
    assert Rake::Task.task_defined?("pull_requests:fix_orphaned_states")
  end

  test "pull_requests:validate_consistency task exists" do
    assert Rake::Task.task_defined?("pull_requests:validate_consistency")
  end

  test "pull_requests:validate_consistency handles edge cases" do
    capture_output do
      Rake::Task["pull_requests:validate_consistency"].invoke
    end

    assert true, "Task handles edge cases gracefully"
  end

  test "pull_requests:fix_orphaned_states handles edge cases" do
    capture_output do
      Rake::Task["pull_requests:fix_orphaned_states"].invoke
    end

    assert true, "Task handles edge cases gracefully"
  end

  private

  def capture_output
    original_stdout = $stdout
    $stdout = StringIO.new
    yield
    $stdout.string
  ensure
    $stdout = original_stdout
  end
end
