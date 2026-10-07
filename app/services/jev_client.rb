require "json"
require "net/http"
require "uri"

class JevClient
  class Error < StandardError; end
  class ConfigurationError < Error; end
  class ApiError < Error; end

  DEFAULT_MODEL = "~typesafe/jev-latest".freeze
  DEFAULT_BASE_URL = "https://openrouter.ai".freeze
  DECISIONS_PATH = "/api/alpha/decisions".freeze
  DEFAULT_TIMEOUT = 30

  def initialize(api_key: nil, model: DEFAULT_MODEL, base_url: nil, timeout: DEFAULT_TIMEOUT)
    @api_key = api_key.presence || ENV["OPENROUTER_API_KEY"].presence || load_jev_config_key
    @model = model
    @base_url = (base_url.presence || ENV["JEV_BASE_URL"].presence || DEFAULT_BASE_URL).to_s.sub(%r{/api/v1/?\z}, "")
    @timeout = timeout
  end

  def configured?
    @api_key.present?
  end

  def decide(state:, questions:, session_id: nil, user: nil)
    raise ConfigurationError, "OPENROUTER_API_KEY is not set" unless configured?

    body = {
      model: @model,
      state: state,
      questions: questions
    }
    body[:session_id] = session_id if session_id.present?
    body[:user] = user if user.present?

    response = post_json(body)
    answers = response["answers"]
    raise ApiError, "Jev response missing answers" unless answers.is_a?(Hash)

    response
  end

  private

  def post_json(body)
    uri = URI.join(@base_url.end_with?("/") ? @base_url : "#{@base_url}/", DECISIONS_PATH.sub(%r{\A/}, ""))
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = @timeout
    http.read_timeout = @timeout

    request = Net::HTTP::Post.new(uri)
    request["Authorization"] = "Bearer #{@api_key}"
    request["Content-Type"] = "application/json"
    request["HTTP-Referer"] = "https://github.com/forge-app/forge"
    request["X-Title"] = "Forge file triage"
    request.body = JSON.generate(body)

    response = http.request(request)
    parsed = parse_body(response.body)

    unless response.is_a?(Net::HTTPSuccess)
      message = parsed.is_a?(Hash) ? (parsed.dig("error", "message") || parsed["error"] || parsed["message"]) : nil
      raise ApiError, message.presence || "Jev request failed (HTTP #{response.code})"
    end

    raise ApiError, "Jev response was not a JSON object" unless parsed.is_a?(Hash)

    parsed
  rescue JSON::ParserError => e
    raise ApiError, "Jev response parse failed: #{e.message}"
  rescue Timeout::Error, Errno::ECONNREFUSED, Errno::EHOSTUNREACH, SocketError => e
    raise ApiError, "Jev network error: #{e.message}"
  end

  def parse_body(body)
    return {} if body.blank?

    JSON.parse(body)
  end

  def load_jev_config_key
    path = File.expand_path("~/.config/jev/config.json")
    return nil unless File.file?(path)

    data = JSON.parse(File.read(path))
    data["apiKey"].presence || data["api_key"].presence
  rescue JSON::ParserError, Errno::ENOENT
    nil
  end
end
