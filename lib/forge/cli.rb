require "optparse"
require_relative "client"
require_relative "formatter"

module Forge
  class Cli
    def self.start(argv, stdout: $stdout, stderr: $stderr, env: ENV, sleep_proc: ->(seconds) { sleep(seconds) })
      new(argv, stdout:, stderr:, env:, sleep_proc:).run
    end

    def initialize(argv, stdout:, stderr:, env:, sleep_proc:)
      @argv = argv.dup
      @stdout = stdout
      @stderr = stderr
      @sleep_proc = sleep_proc
      @client = Client.new(base_url: env.fetch("FORGE_API_URL", "http://127.0.0.1:3000"))
    end

    def run
      command = @argv.shift
      return write_error("Usage: forge <command>") if command.nil?

      case command
      when "sync" then run_sync
      when "review" then run_review
      when "status" then run_status
      when "list" then run_list
      when "logs" then run_logs
      when "repo" then run_repo
      else
        write_error("Unknown command: #{command}")
      end
    rescue OptionParser::ParseError => e
      write_error(e.message)
    rescue Client::ConnectionError => e
      @stderr.puts("Connection error: #{e.message}")
      2
    rescue Client::ApiError => e
      @stderr.puts("API error (#{e.code}): #{e.message}")
      1
    end

    private

    def run_sync
      opts = { force: false, json: false }
      OptionParser.new do |o|
        o.on("--force") { opts[:force] = true }
        o.on("--json") { opts[:json] = true }
      end.parse!(@argv)

      result = @client.sync(force: opts[:force])
      Forge::Formatter.dump(opts[:json], opts[:json] ? result : Forge::Formatter.sync_result(result), io: @stdout)
      0
    end

    def run_review
      opts = { json: false }
      OptionParser.new do |o|
        o.on("--client CLIENT") { |v| opts[:client] = v }
        o.on("--type TYPE") { |v| opts[:type] = v }
        o.on("--json") { opts[:json] = true }
      end.parse!(@argv)

      pr_url = @argv.shift
      return write_error("Usage: forge review <pr-url>") if pr_url.nil?

      result = @client.review(pr_url:, cli_client: opts[:client], review_type: opts[:type])
      Forge::Formatter.dump(opts[:json], opts[:json] ? result : Forge::Formatter.review_result(result), io: @stdout)
      0
    end

    def run_status
      opts = { json: false }
      OptionParser.new { |o| o.on("--json") { opts[:json] = true } }.parse!(@argv)

      result = @client.status
      Forge::Formatter.dump(opts[:json], opts[:json] ? result : Forge::Formatter.status_result(result), io: @stdout)
      0
    end

    def run_list
      opts = { json: false }
      OptionParser.new do |o|
        o.on("--status STATUS") { |v| opts[:status] = v }
        o.on("--limit LIMIT", Integer) { |v| opts[:limit] = v }
        o.on("--json") { opts[:json] = true }
      end.parse!(@argv)

      result = @client.list(status: opts[:status], limit: opts[:limit])
      Forge::Formatter.dump(opts[:json], opts[:json] ? result : Forge::Formatter.list_result(result), io: @stdout)
      0
    end

    def run_logs
      opts = { json: false, follow: false }
      OptionParser.new do |o|
        o.on("--tail TAIL", Integer) { |v| opts[:tail] = v }
        o.on("--follow") { opts[:follow] = true }
        o.on("--json") { opts[:json] = true }
      end.parse!(@argv)

      task_id = @argv.shift
      return write_error("Usage: forge logs <task-id>") if task_id.nil?

      result = @client.logs(task_id:, tail: opts[:tail])
      Forge::Formatter.dump(opts[:json], opts[:json] ? result : Forge::Formatter.logs_result(result), io: @stdout)

      return 0 unless opts[:follow]
      return write_error("--follow and --json are incompatible") if opts[:json]

      last_id = result.fetch("logs", []).map { |log| log["id"] }.max
      loop do
        poll = @client.logs(task_id:, tail: opts[:tail], after_id: last_id)
        new_logs = poll.fetch("logs", [])

        if new_logs.any?
          @stdout.puts(Forge::Formatter.logs_result(poll))
          last_id = new_logs.map { |log| log["id"] }.max
        end

        @sleep_proc.call(2)
      end
    rescue Interrupt
      0
    end

    def run_repo
      subcommand = @argv.shift
      return write_error("Usage: forge repo switch <org/repo>") if subcommand != "switch"

      opts = { json: false }
      OptionParser.new { |o| o.on("--json") { opts[:json] = true } }.parse!(@argv)

      repo = @argv.shift
      return write_error("Usage: forge repo switch <org/repo>") if repo.nil?

      result = @client.switch_repo(repo: repo)
      Forge::Formatter.dump(opts[:json], opts[:json] ? result : Forge::Formatter.switch_result(result), io: @stdout)
      0
    end

    def write_error(message)
      @stderr.puts(message)
      1
    end
  end

  CLI = Cli
end
