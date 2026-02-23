require "json"

module Forge
  module Formatter
    module_function

    def dump(json_mode, output, io: $stdout)
      io.puts(json_mode ? JSON.pretty_generate(output) : output)
    end

    def sync_result(result)
      if result["skipped"]
        "Sync skipped (#{result["seconds_remaining"]}s remaining)"
      else
        "Synced successfully"
      end
    end

    def review_result(result)
      message = "Review task ##{result["task_id"]} #{result["state"]}"
      return message unless result["queue_position"]

      "#{message} (queue position #{result["queue_position"]})"
    end

    def status_result(result)
      counts = result.fetch("counts", {})
      "repo=#{result["repo"] || "none"} pending=#{counts["pending_review"]} in_review=#{counts["in_review"]} queued=#{counts["queued"]} failed=#{counts["failed_review"]}"
    end

    def list_result(result)
      items = result.fetch("items", [])
      return "No pull requests" if items.empty?

      items.map { |item| "##{item["number"]} [#{item["review_status"]}] #{item["repo"]} #{item["title"]}" }.join("\n")
    end

    def logs_result(result)
      logs = result.fetch("logs", [])
      return "No logs" if logs.empty?

      logs.map { |log| "[#{log["id"]}] #{log["log_type"]}: #{log["message"]}" }.join("\n")
    end

    def switch_result(result)
      "Switched to #{result["repo"]} (#{result["repo_path"]})"
    end
  end
end
