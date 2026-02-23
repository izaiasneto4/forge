require "test_helper"

class PullRequestUrlParserTest < ActiveSupport::TestCase
  test "parses valid github url" do
    parsed = PullRequestUrlParser.parse("https://github.com/acme/api/pull/42")

    assert_equal "https://github.com/acme/api/pull/42", parsed[:url]
    assert_equal "acme", parsed[:owner]
    assert_equal "api", parsed[:name]
    assert_equal 42, parsed[:number]
    assert_equal "acme/api", parsed[:repo]
  end

  test "parses url with trailing path" do
    parsed = PullRequestUrlParser.parse("https://github.com/acme/api/pull/42/files")

    assert_equal 42, parsed[:number]
  end

  test "returns nil for invalid url" do
    assert_nil PullRequestUrlParser.parse("https://example.com/foo")
    assert_nil PullRequestUrlParser.parse("")
    assert_nil PullRequestUrlParser.parse(nil)
  end
end
