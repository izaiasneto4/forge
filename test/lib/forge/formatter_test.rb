require "test_helper"
require "stringio"
require "forge/formatter"

class ForgeFormatterTest < ActiveSupport::TestCase
  test "sync_result covers skipped and synced" do
    assert_match(/skipped/, Forge::Formatter.sync_result({ "skipped" => true, "seconds_remaining" => 7 }))
    assert_equal "Synced successfully", Forge::Formatter.sync_result({ "skipped" => false })
  end

  test "review_result covers queued and non queued" do
    assert_equal "Review task #1 pending_review", Forge::Formatter.review_result({ "task_id" => 1, "state" => "pending_review", "queue_position" => nil })
    assert_match(/queue position 2/, Forge::Formatter.review_result({ "task_id" => 1, "state" => "queued", "queue_position" => 2 }))
  end

  test "status_result includes counts" do
    text = Forge::Formatter.status_result({ "repo" => "acme/api", "counts" => { "pending_review" => 1, "in_review" => 2, "queued" => 3, "failed_review" => 4 } })
    assert_match(/acme\/api/, text)
    assert_match(/pending=1/, text)
  end

  test "list_result covers empty and non-empty" do
    assert_equal "No pull requests", Forge::Formatter.list_result({ "items" => [] })
    text = Forge::Formatter.list_result({ "items" => [ { "number" => 2, "review_status" => "pending_review", "repo" => "acme/api", "title" => "Fix" } ] })
    assert_match(/#2/, text)
  end

  test "logs_result covers empty and non-empty" do
    assert_equal "No logs", Forge::Formatter.logs_result({ "logs" => [] })
    text = Forge::Formatter.logs_result({ "logs" => [ { "id" => 1, "log_type" => "output", "message" => "ok" } ] })
    assert_match(/\[1\]/, text)
  end

  test "switch_result and dump json/text" do
    assert_match(/acme\/api/, Forge::Formatter.switch_result({ "repo" => "acme/api", "repo_path" => "/tmp/r" }))

    io = StringIO.new
    Forge::Formatter.dump(false, "hello", io: io)
    assert_equal "hello\n", io.string

    io = StringIO.new
    Forge::Formatter.dump(true, { "a" => 1 }, io: io)
    assert_match(/"a"/, io.string)
  end
end
