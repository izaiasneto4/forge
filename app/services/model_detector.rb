require "json"

class ModelDetector
  UNKNOWN_MODEL = "unknown".freeze

  class << self
    def detect(cli_client)
      case cli_client
      when "opencode"
        detect_opencode_model
      when "codex"
        detect_codex_model
      when "claude"
        detect_claude_model
      else
        UNKNOWN_MODEL
      end
    rescue => e
      Rails.logger.warn("ModelDetector: Failed to detect model for #{cli_client}: #{e.message}")
      UNKNOWN_MODEL
    end

    private

    def detect_opencode_model
      model_file = File.expand_path("~/.local/state/opencode/model.json")
      return UNKNOWN_MODEL unless File.exist?(model_file)

      data = JSON.parse(File.read(model_file))
      recent = data.dig("recent", 0)
      return UNKNOWN_MODEL unless recent

      provider = recent["providerID"]
      model = recent["modelID"]
      return UNKNOWN_MODEL unless model

      # Include provider for clarity (e.g., "google/antigravity-gemini-3-pro")
      provider.present? ? "#{provider}/#{model}" : model
    rescue JSON::ParserError
      UNKNOWN_MODEL
    end

    def detect_codex_model
      config_file = File.expand_path("~/.codex/config.toml")
      return UNKNOWN_MODEL unless File.exist?(config_file)

      # Simple TOML parsing for the model key (top-level only)
      content = File.read(config_file)
      match = content.match(/^model\s*=\s*"([^"]+)"/)
      match ? match[1] : UNKNOWN_MODEL
    end

    def detect_claude_model
      # Claude Code uses environment variables or internal config
      # Check common environment variables first
      env_model = ENV["ANTHROPIC_MODEL"] || ENV["CLAUDE_MODEL"]
      return env_model if env_model.present?

      # Check Claude config file
      config_file = File.expand_path("~/.claude/settings.json")
      if File.exist?(config_file)
        config = JSON.parse(File.read(config_file))
        model = config["model"] || config.dig("preferences", "model")
        return model if model.present?
      end

      # Default Claude model (can be overridden by CLI -m flag)
      # Since we can't reliably detect, return "claude" as identifier
      "claude"
    rescue JSON::ParserError
      "claude"
    end
  end
end
