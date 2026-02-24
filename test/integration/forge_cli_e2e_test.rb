require "test_helper"
require "json"
require "open3"
require "socket"
require "webrick"

class ForgeCliE2eTest < ActiveSupport::TestCase
  def bin_path
    Rails.root.join("bin/forge").to_s
  end

  def run_cli(args, base_url:)
    env = { "FORGE_API_URL" => base_url }
    stdout, stderr, status = Open3.capture3(env, bin_path, *args)
    [ stdout, stderr, status.exitstatus ]
  end

  def find_port
    socket = TCPServer.new("127.0.0.1", 0)
    port = socket.addr[1]
    socket.close
    port
  end

  def with_stub_server(handler)
    port = find_port
    server = WEBrick::HTTPServer.new(Port: port, BindAddress: "127.0.0.1", Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
    server.mount_proc "/" do |req, res|
      status, payload = handler.call(req)
      res.status = status
      res["Content-Type"] = "application/json"
      res.body = JSON.dump(payload)
    end

    thread = Thread.new { server.start }
    sleep 0.1
    yield "http://127.0.0.1:#{port}"
  ensure
    server&.shutdown
    thread&.join
  end

  test "sync forced and skipped and failure and connection error" do
    handler = proc do |req|
      body = JSON.parse(req.body.presence || "{}")
      if body["force"]
        [ 200, { ok: true, skipped: false } ]
      else
        [ 200, { ok: true, skipped: true, seconds_remaining: 15 } ]
      end
    end

    with_stub_server(handler) do |base_url|
      _out, _err, code = run_cli([ "sync", "--force" ], base_url:)
      assert_equal 0, code

      _out, _err, code = run_cli([ "sync" ], base_url:)
      assert_equal 0, code
    end

    with_stub_server(proc { |_req| [ 422, { ok: false, error: { code: "sync_failed", message: "boom" } } ] }) do |base_url|
      _out, err, code = run_cli([ "sync", "--force" ], base_url:)
      assert_equal 1, code
      assert_match(/sync_failed/, err)
    end

    _out, err, code = run_cli([ "sync", "--force" ], base_url: "http://127.0.0.1:#{find_port}")
    assert_equal 2, code
    assert_match(/Connection error/, err)
  end

  test "review edge cases" do
    handler = proc do |req|
      pr_url = JSON.parse(req.body)["pr_url"]
      case pr_url
      when "https://github.com/acme/api/pull/1"
        [ 201, { ok: true, task_id: 1, state: "pending_review", queue_position: nil } ]
      when "https://github.com/acme/api/pull/2"
        [ 201, { ok: true, task_id: 2, state: "queued", queue_position: 2 } ]
      when "https://github.com/acme/api/pull/3"
        [ 409, { ok: false, error: { code: "conflict", message: "already running" } } ]
      when "https://github.com/mismatch/repo/pull/1"
        [ 422, { ok: false, error: { code: "invalid_input", message: "mismatch" } } ]
      else
        [ 422, { ok: false, error: { code: "invalid_input", message: "bad url" } } ]
      end
    end

    with_stub_server(handler) do |base_url|
      _out, _err, code = run_cli([ "review", "https://github.com/acme/api/pull/1" ], base_url:)
      assert_equal 0, code

      out, _err, code = run_cli([ "review", "https://github.com/acme/api/pull/2" ], base_url:)
      assert_equal 0, code
      assert_match(/queue position/, out)

      _out, _err, code = run_cli([ "review", "https://github.com/acme/api/pull/3" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "review", "https://github.com/mismatch/repo/pull/1" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "review", "bad-url" ], base_url:)
      assert_equal 1, code
    end
  end

  test "status and list edge cases" do
    handler = proc do |req|
      if req.path == "/api/v1/status"
        [ 200, { ok: true, repo: "acme/api", counts: { pending_review: 0, in_review: 1, queued: 1, failed_review: 1 } } ]
      else
        q = WEBrick::HTTPUtils.parse_query(req.query_string.to_s)
        if q["status"] == "invalid" || q["limit"] == "0" || q["limit"] == "9999"
          [ 422, { ok: false, error: { code: "invalid_input", message: "bad" } } ]
        else
          [ 200, { ok: true, items: [ { number: 1, review_status: "pending_review", repo: "acme/api", title: "Fix" } ] } ]
        end
      end
    end

    with_stub_server(handler) do |base_url|
      _out, _err, code = run_cli([ "status" ], base_url:)
      assert_equal 0, code

      _out, _err, code = run_cli([ "list" ], base_url:)
      assert_equal 0, code

      _out, _err, code = run_cli([ "list", "--status", "invalid" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "list", "--limit", "0" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "list", "--limit", "9999" ], base_url:)
      assert_equal 1, code
    end
  end

  test "logs edge cases" do
    handler = proc do |req|
      if req.path == "/api/v1/review_tasks/1/logs"
        q = WEBrick::HTTPUtils.parse_query(req.query_string.to_s)
        if q["tail"] == "0"
          [ 422, { ok: false, error: { code: "invalid_input", message: "bad tail" } } ]
        else
          [ 200, { ok: true, logs: [ { id: 1, log_type: "output", message: "first" }, { id: 2, log_type: "error", message: "second" } ] } ]
        end
      elsif req.path == "/api/v1/review_tasks/2/logs"
        [ 200, { ok: true, logs: [] } ]
      else
        [ 404, { ok: false, error: { code: "not_found", message: "missing" } } ]
      end
    end

    with_stub_server(handler) do |base_url|
      _out, _err, code = run_cli([ "logs", "1", "--tail", "2" ], base_url:)
      assert_equal 0, code

      out, _err, code = run_cli([ "logs", "2" ], base_url:)
      assert_equal 0, code
      assert_match(/No logs/, out)

      _out, _err, code = run_cli([ "logs", "999" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "logs", "1", "--tail", "0" ], base_url:)
      assert_equal 1, code
    end
  end

  test "repo switch edge cases" do
    handler = proc do |req|
      repo = JSON.parse(req.body)["repo"]
      case repo
      when "acme/api"
        [ 201, { ok: true, repo: repo, repo_path: "/tmp/acme-api", synced: true } ]
      when "missing/api"
        [ 404, { ok: false, error: { code: "not_found", message: "missing" } } ]
      when "multi/api"
        [ 409, { ok: false, error: { code: "conflict", message: "multiple" } } ]
      when "invalid"
        [ 422, { ok: false, error: { code: "invalid_input", message: "invalid" } } ]
      else
        [ 422, { ok: false, error: { code: "sync_failed", message: "sync failed" } } ]
      end
    end

    with_stub_server(handler) do |base_url|
      _out, _err, code = run_cli([ "repo", "switch", "acme/api" ], base_url:)
      assert_equal 0, code

      _out, _err, code = run_cli([ "repo", "switch", "missing/api" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "repo", "switch", "multi/api" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "repo", "switch", "invalid" ], base_url:)
      assert_equal 1, code

      _out, _err, code = run_cli([ "repo", "switch", "syncfail/api" ], base_url:)
      assert_equal 1, code
    end
  end
end
