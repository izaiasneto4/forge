require "test_helper"
require "json"

class JevClientTest < ActiveSupport::TestCase
  test "configured? is true when api key provided" do
    client = JevClient.new(api_key: "sk-test")
    assert_equal true, client.configured?
  end

  test "decide raises configuration error without api key" do
    original = ENV["OPENROUTER_API_KEY"]
    ENV.delete("OPENROUTER_API_KEY")
    JevClient.any_instance.stubs(:load_jev_config_key).returns(nil)
    client = JevClient.new(api_key: nil)

    error = assert_raises(JevClient::ConfigurationError) do
      client.decide(state: { "x" => 1 }, questions: { "q" => { "type" => "noul", "instructions" => "yes?" } })
    end

    assert_match /OPENROUTER_API_KEY/i, error.message
  ensure
    ENV["OPENROUTER_API_KEY"] = original if original
  end

  test "decide posts to decisions endpoint and returns answers" do
    client = JevClient.new(api_key: "sk-test", base_url: "https://openrouter.ai")
    payload = {
      "answers" => {
        "is_bug" => { "type" => "noul", "noul" => 0.9 }
      },
      "usage" => { "cost" => 0.0001 }
    }

    fake_response = stub(body: JSON.generate(payload), code: "200", is_a?: true)
    fake_response.stubs(:is_a?).with(Net::HTTPSuccess).returns(true)

    http = mock
    http.expects(:use_ssl=).with(true)
    http.expects(:open_timeout=)
    http.expects(:read_timeout=)
    http.expects(:request).returns(fake_response)
    Net::HTTP.stubs(:new).returns(http)

    result = client.decide(
      state: { "ticket" => "broken checkout" },
      questions: {
        "is_bug" => {
          "type" => "noul",
          "instructions" => "Is this a bug?"
        }
      }
    )

    assert_equal 0.9, result.dig("answers", "is_bug", "noul")
  end
end
