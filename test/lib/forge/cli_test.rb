require "test_helper"
require "stringio"
require "forge/cli"

class ForgeCLITest < ActiveSupport::TestCase
  def run_cli(argv, client: nil, sleep_proc: ->(_n) {})
    stdout = StringIO.new
    stderr = StringIO.new

    Forge::Client.stubs(:new).returns(client) if client

    code = Forge::CLI.start(argv, stdout:, stderr:, env: { "FORGE_API_URL" => "http://example.test" }, sleep_proc:)
    [code, stdout.string, stderr.string]
  end

  test "unknown command returns 1" do
    code, _out, err = run_cli(["wat"])
    assert_equal 1, code
    assert_match(/Unknown command/, err)
  end

  test "sync command success" do
    client = mock
    client.expects(:sync).with(force: true).returns({ "skipped" => false })
    code, out, = run_cli(["sync", "--force"], client:)
    assert_equal 0, code
    assert_match(/Synced successfully/, out)
  end

  test "sync --json" do
    client = mock
    client.expects(:sync).with(force: false).returns({ "ok" => true, "skipped" => true, "seconds_remaining" => 2 })
    code, out, = run_cli(["sync", "--json"], client:)
    assert_equal 0, code
    assert_match(/"ok"/, out)
  end

  test "review requires pr url" do
    code, _out, err = run_cli(["review"])
    assert_equal 1, code
    assert_match(/Usage: forge review/, err)
  end

  test "review with options" do
    client = mock
    client.expects(:review).with(pr_url: "https://github.com/acme/api/pull/1", cli_client: "codex", review_type: "swarm").returns({ "task_id" => 1, "state" => "queued", "queue_position" => 2 })
    code, out, = run_cli(["review", "https://github.com/acme/api/pull/1", "--client", "codex", "--type", "swarm"], client:)
    assert_equal 0, code
    assert_match(/queue position 2/, out)
  end

  test "review --json" do
    client = mock
    client.expects(:review).with(pr_url: "https://github.com/acme/api/pull/1", cli_client: nil, review_type: nil).returns({ "ok" => true })
    code, out, = run_cli(["review", "https://github.com/acme/api/pull/1", "--json"], client:)
    assert_equal 0, code
    assert_match(/\"ok\"/, out)
  end

  test "status command" do
    client = mock
    client.expects(:status).returns({ "repo" => "acme/api", "counts" => { "pending_review" => 1, "in_review" => 0, "queued" => 0, "failed_review" => 0 } })
    code, out, = run_cli(["status"], client:)
    assert_equal 0, code
    assert_match(/acme\/api/, out)
  end

  test "status --json" do
    client = mock
    client.expects(:status).returns({ "ok" => true })
    code, out, = run_cli(["status", "--json"], client:)
    assert_equal 0, code
    assert_match(/\"ok\"/, out)
  end

  test "list command" do
    client = mock
    client.expects(:list).with(status: "pending_review", limit: 10).returns({ "items" => [] })
    code, out, = run_cli(["list", "--status", "pending_review", "--limit", "10"], client:)
    assert_equal 0, code
    assert_match(/No pull requests/, out)
  end

  test "list --json" do
    client = mock
    client.expects(:list).with(status: nil, limit: nil).returns({ "items" => [] })
    code, out, = run_cli(["list", "--json"], client:)
    assert_equal 0, code
    assert_match(/\"items\"/, out)
  end

  test "logs command requires id" do
    code, _out, err = run_cli(["logs"])
    assert_equal 1, code
    assert_match(/Usage: forge logs/, err)
  end

  test "logs without follow returns 0" do
    client = mock
    client.expects(:logs).with(task_id: "1", tail: nil).returns({ "logs" => [] })
    code, out, = run_cli(["logs", "1"], client:)
    assert_equal 0, code
    assert_match(/No logs/, out)
  end

  test "logs follow with interrupt" do
    client = mock
    client.expects(:logs).with(task_id: "1", tail: 5).returns({ "logs" => [{ "id" => 1, "log_type" => "output", "message" => "first" }] })
    client.expects(:logs).with(task_id: "1", tail: 5, after_id: 1).raises(Interrupt)

    code, out, = run_cli(["logs", "1", "--tail", "5", "--follow"], client:, sleep_proc: ->(_n) {})
    assert_equal 0, code
    assert_match(/first/, out)
  end

  test "logs follow prints new logs and sleeps" do
    client = mock
    sleeps = []
    client.expects(:logs).with(task_id: "1", tail: 5).returns({ "logs" => [{ "id" => 1, "log_type" => "output", "message" => "first" }] })
    client.expects(:logs).with(task_id: "1", tail: 5, after_id: 1).returns({ "logs" => [{ "id" => 2, "log_type" => "output", "message" => "second" }] })
    client.expects(:logs).with(task_id: "1", tail: 5, after_id: 2).raises(Interrupt)

    code, out, = run_cli(["logs", "1", "--tail", "5", "--follow"], client:, sleep_proc: ->(n) { sleeps << n })
    assert_equal 0, code
    assert_match(/second/, out)
    assert_equal [2], sleeps
  end

  test "logs follow with no new logs still sleeps" do
    client = mock
    sleeps = []
    client.expects(:logs).with(task_id: "1", tail: 5).returns({ "logs" => [{ "id" => 1, "log_type" => "output", "message" => "first" }] })
    client.expects(:logs).with(task_id: "1", tail: 5, after_id: 1).returns({ "logs" => [] })

    code, _out, = run_cli(["logs", "1", "--tail", "5", "--follow"], client:, sleep_proc: ->(n) { sleeps << n; raise Interrupt })
    assert_equal 0, code
    assert_equal [2], sleeps
  end

  test "logs follow incompatible with json" do
    client = mock
    client.expects(:logs).with(task_id: "1", tail: nil).returns({ "logs" => [] })

    code, _out, err = run_cli(["logs", "1", "--follow", "--json"], client:)
    assert_equal 1, code
    assert_match(/incompatible/, err)
  end

  test "repo command usage errors" do
    code, _out, err = run_cli(["repo"])
    assert_equal 1, code
    assert_match(/Usage: forge repo switch/, err)
  end

  test "repo switch success" do
    client = mock
    client.expects(:switch_repo).with(repo: "acme/api").returns({ "repo" => "acme/api", "repo_path" => "/tmp/r" })
    code, out, = run_cli(["repo", "switch", "acme/api"], client:)
    assert_equal 0, code
    assert_match(/Switched to acme\/api/, out)
  end

  test "repo switch usage missing repo" do
    code, _out, err = run_cli(["repo", "switch"])
    assert_equal 1, code
    assert_match(/Usage: forge repo switch/, err)
  end

  test "repo switch --json" do
    client = mock
    client.expects(:switch_repo).with(repo: "acme/api").returns({ "ok" => true })
    code, out, = run_cli(["repo", "switch", "acme/api", "--json"], client:)
    assert_equal 0, code
    assert_match(/\"ok\"/, out)
  end

  test "api error maps to exit 1" do
    client = mock
    client.expects(:status).raises(Forge::Client::ApiError.new("bad", code: "invalid", status: 422))
    code, _out, err = run_cli(["status"], client:)
    assert_equal 1, code
    assert_match(/API error/, err)
  end

  test "connection error maps to exit 2" do
    client = mock
    client.expects(:status).raises(Forge::Client::ConnectionError.new("down"))
    code, _out, err = run_cli(["status"], client:)
    assert_equal 2, code
    assert_match(/Connection error/, err)
  end

  test "option parse error returns 1" do
    code, _out, err = run_cli(["list", "--limit", "oops"])
    assert_equal 1, code
    assert_match(/invalid argument/, err)
  end

  test "usage when command missing" do
    code, _out, err = run_cli([])
    assert_equal 1, code
    assert_match(/Usage: forge/, err)
  end
end
