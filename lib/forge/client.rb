require "json"
require "net/http"
require "uri"

module Forge
  class Client
    class Error < StandardError; end
    class ConnectionError < Error; end

    class ApiError < Error
      attr_reader :code, :status

      def initialize(message, code:, status:)
        @code = code
        @status = status
        super(message)
      end
    end

    def initialize(base_url: ENV.fetch("FORGE_API_URL", "http://127.0.0.1:3000"), timeout: 10)
      @base_url = base_url
      @timeout = timeout
    end

    def sync(force: false)
      post_json("/api/v1/sync", { force: force })
    end

    def review(pr_url:, cli_client: nil, review_type: nil)
      payload = { pr_url: pr_url }
      payload[:cli_client] = cli_client if cli_client
      payload[:review_type] = review_type if review_type
      post_json("/api/v1/reviews", payload)
    end

    def status
      get_json("/api/v1/status")
    end

    def list(status: nil, limit: nil)
      query = {}
      query[:status] = status if status
      query[:limit] = limit if limit
      get_json("/api/v1/pull_requests", query)
    end

    def logs(task_id:, tail: nil, after_id: nil)
      query = {}
      query[:tail] = tail if tail
      query[:after_id] = after_id if after_id
      get_json("/api/v1/review_tasks/#{task_id}/logs", query)
    end

    def switch_repo(repo:)
      post_json("/api/v1/repositories/switch", { repo: repo })
    end

    private

    def get_json(path, query = {})
      uri = build_uri(path, query)
      request = Net::HTTP::Get.new(uri)
      perform(uri, request)
    end

    def post_json(path, payload)
      uri = build_uri(path)
      request = Net::HTTP::Post.new(uri)
      request["Content-Type"] = "application/json"
      request.body = JSON.dump(payload)
      perform(uri, request)
    end

    def perform(uri, request)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = @timeout
      http.read_timeout = @timeout
      response = http.request(request)

      parsed = parse_body(response.body)
      return parsed if response.code.to_i.between?(200, 299)

      code = parsed.dig("error", "code") || "unknown"
      message = parsed.dig("error", "message") || "Request failed"
      raise ApiError.new(message, code: code, status: response.code.to_i)
    rescue Errno::ECONNREFUSED, SocketError, Net::OpenTimeout, Net::ReadTimeout => e
      raise ConnectionError, e.message
    end

    def parse_body(body)
      return {} if body.nil? || body.strip.empty?

      JSON.parse(body)
    rescue JSON::ParserError
      {}
    end

    def build_uri(path, query = {})
      uri = URI.join(@base_url.end_with?("/") ? @base_url : "#{@base_url}/", path.sub(%r{\A/}, ""))
      uri.query = URI.encode_www_form(query) if query.any?
      uri
    end
  end
end
