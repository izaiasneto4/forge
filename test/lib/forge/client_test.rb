require "test_helper"
require "forge/client"

class ForgeClientTest < ActiveSupport::TestCase
  FakeResponse = Struct.new(:code, :body)

  def stub_http(response, &request_assertion)
    http = mock
    if request_assertion
      http.expects(:request).with { |req| request_assertion.call(req) }.returns(response)
    else
      http.expects(:request).returns(response)
    end
    http.stubs(:use_ssl=)
    http.stubs(:open_timeout=)
    http.stubs(:read_timeout=)
    Net::HTTP.stubs(:new).returns(http)
  end

  test "sync posts payload and parses success" do
    response = FakeResponse.new("200", { ok: true, skipped: false }.to_json)
    stub_http(response)

    result = Forge::Client.new.sync(force: true)

    assert_equal true, result["ok"]
    assert_equal false, result["skipped"]
  end

  test "raises api error on non-2xx" do
    response = FakeResponse.new("422", { ok: false, error: { code: "invalid_input", message: "bad" } }.to_json)
    stub_http(response)

    error = assert_raises(Forge::Client::ApiError) do
      Forge::Client.new.status
    end

    assert_equal "invalid_input", error.code
    assert_equal 422, error.status
  end

  test "raises connection error" do
    Net::HTTP.stubs(:new).raises(Errno::ECONNREFUSED)

    assert_raises(Forge::Client::ConnectionError) do
      Forge::Client.new.status
    end
  end

  test "handles invalid json body" do
    response = FakeResponse.new("200", "not json")
    stub_http(response)

    assert_equal({}, Forge::Client.new.status)
  end

  test "handles empty body" do
    response = FakeResponse.new("200", "")
    stub_http(response)

    assert_equal({}, Forge::Client.new.status)
  end

  test "review includes optional payload fields" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) do |req|
      body = JSON.parse(req.body)
      body["pr_url"] == "https://github.com/acme/api/pull/1" &&
        body["cli_client"] == "codex" &&
        body["review_type"] == "swarm"
    end

    Forge::Client.new.review(pr_url: "https://github.com/acme/api/pull/1", cli_client: "codex", review_type: "swarm")
  end

  test "review omits optional payload fields" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) do |req|
      body = JSON.parse(req.body)
      body["pr_url"] == "https://github.com/acme/api/pull/1" &&
        !body.key?("cli_client") &&
        !body.key?("review_type")
    end

    Forge::Client.new.review(pr_url: "https://github.com/acme/api/pull/1")
  end

  test "list includes query params when provided" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| req.path.include?("status=pending_review") && req.path.include?("limit=5") }

    Forge::Client.new.list(status: "pending_review", limit: 5)
  end

  test "list omits query params when missing" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| req.path == "/api/v1/pull_requests" }

    Forge::Client.new.list
  end

  test "logs includes tail and after_id" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| req.path.include?("tail=10") && req.path.include?("after_id=20") }

    Forge::Client.new.logs(task_id: 1, tail: 10, after_id: 20)
  end

  test "logs omits optional query params" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| req.path == "/api/v1/review_tasks/1/logs" }

    Forge::Client.new.logs(task_id: 1)
  end

  test "switch_repo posts payload" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| JSON.parse(req.body)["repo"] == "acme/api" }

    Forge::Client.new.switch_repo(repo: "acme/api")
  end

  test "build_uri supports base url without trailing slash" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| req.path == "/api/v1/status" }

    Forge::Client.new(base_url: "http://127.0.0.1:3000").status
  end

  test "build_uri supports base url with trailing slash" do
    response = FakeResponse.new("200", { ok: true }.to_json)
    stub_http(response) { |req| req.path == "/api/v1/status" }

    Forge::Client.new(base_url: "http://127.0.0.1:3000/").status
  end

  test "returns unknown api error when body missing error details" do
    response = FakeResponse.new("500", "{}")
    stub_http(response)

    error = assert_raises(Forge::Client::ApiError) { Forge::Client.new.status }
    assert_equal "unknown", error.code
    assert_equal "Request failed", error.message
  end
end
