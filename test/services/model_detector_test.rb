require "test_helper"

class ModelDetectorTest < ActiveSupport::TestCase
  setup do
    @original_home = ENV["HOME"]
  end

  teardown do
    ENV["HOME"] = @original_home
    ENV.delete("ANTHROPIC_MODEL")
    ENV.delete("CLAUDE_MODEL")
  end

  # detect method tests
  test "detect returns opencode model for opencode client" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      model_file = File.join(tmp_home, ".local", "state", "opencode", "model.json")
      FileUtils.mkdir_p(File.dirname(model_file))
      File.write(model_file, JSON.generate({ "recent" => [ { "providerID" => "google", "modelID" => "gemini-3-pro" } ] }))

      assert_equal "google/gemini-3-pro", ModelDetector.detect("opencode")
    end
  end

  test "detect returns codex model for codex client" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".codex", "config.toml")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, 'model = "openai/gpt-4"')

      assert_equal "openai/gpt-4", ModelDetector.detect("codex")
    end
  end

  test "detect returns claude model for claude client" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".claude", "settings.json")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, JSON.generate({ "model" => "claude-3.5-sonnet" }))

      assert_equal "claude-3.5-sonnet", ModelDetector.detect("claude")
    end
  end

  test "detect returns unknown for unknown client" do
    assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.detect("unknown_client")
  end

  test "detect returns unknown for nil client" do
    assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.detect(nil)
  end

  # detect_opencode_model tests
  test "detect_opencode_model returns UNKNOWN_MODEL when file missing" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.send(:detect_opencode_model)
    end
  end

  test "detect_opencode_model returns UNKNOWN_MODEL for malformed JSON" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      model_file = File.join(tmp_home, ".local", "state", "opencode", "model.json")
      FileUtils.mkdir_p(File.dirname(model_file))
      File.write(model_file, "{ invalid json }")

      assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.send(:detect_opencode_model)
    end
  end

  test "detect_opencode_model returns UNKNOWN_MODEL when recent array empty" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      model_file = File.join(tmp_home, ".local", "state", "opencode", "model.json")
      FileUtils.mkdir_p(File.dirname(model_file))
      File.write(model_file, JSON.generate({ "recent" => [] }))

      assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.send(:detect_opencode_model)
    end
  end

  test "detect_opencode_model returns UNKNOWN_MODEL when modelID missing" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      model_file = File.join(tmp_home, ".local", "state", "opencode", "model.json")
      FileUtils.mkdir_p(File.dirname(model_file))
      File.write(model_file, JSON.generate({ "recent" => [ { "providerID" => "google" } ] }))

      assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.send(:detect_opencode_model)
    end
  end

  test "detect_opencode_model returns model only when provider missing" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      model_file = File.join(tmp_home, ".local", "state", "opencode", "model.json")
      FileUtils.mkdir_p(File.dirname(model_file))
      File.write(model_file, JSON.generate({ "recent" => [ { "modelID" => "gemini-3-pro" } ] }))

      assert_equal "gemini-3-pro", ModelDetector.send(:detect_opencode_model)
    end
  end

  test "detect_opencode_model returns provider/model format" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      model_file = File.join(tmp_home, ".local", "state", "opencode", "model.json")
      FileUtils.mkdir_p(File.dirname(model_file))
      File.write(model_file, JSON.generate({ "recent" => [ { "providerID" => "google", "modelID" => "gemini-3-pro" } ] }))

      assert_equal "google/gemini-3-pro", ModelDetector.send(:detect_opencode_model)
    end
  end

  # detect_codex_model tests
  test "detect_codex_model returns UNKNOWN_MODEL when file missing" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.send(:detect_codex_model)
    end
  end

  test "detect_codex_model returns UNKNOWN_MODEL when model key missing" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".codex", "config.toml")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, "other_key = value")

      assert_equal ModelDetector::UNKNOWN_MODEL, ModelDetector.send(:detect_codex_model)
    end
  end

  test "detect_codex_model returns model from TOML config" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".codex", "config.toml")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, 'model = "openai/gpt-4"')

      assert_equal "openai/gpt-4", ModelDetector.send(:detect_codex_model)
    end
  end

  test "detect_codex_model handles model with spaces" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".codex", "config.toml")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, 'model =  "openai/gpt-4"')

      assert_equal "openai/gpt-4", ModelDetector.send(:detect_codex_model)
    end
  end

  # detect_claude_model tests
  test "detect_claude_model prefers ANTHROPIC_MODEL env var" do
    ENV["ANTHROPIC_MODEL"] = "claude-3.5-sonnet"
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      assert_equal "claude-3.5-sonnet", ModelDetector.send(:detect_claude_model)
    end
  end

  test "detect_claude_model prefers CLAUDE_MODEL env var over config" do
    ENV["CLAUDE_MODEL"] = "claude-3-opus"
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".claude", "settings.json")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, JSON.generate({ "model" => "claude-3.5-sonnet" }))

      assert_equal "claude-3-opus", ModelDetector.send(:detect_claude_model)
    end
  end

  test "detect_claude_model reads model from config file" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".claude", "settings.json")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, JSON.generate({ "model" => "claude-3.5-sonnet" }))

      assert_equal "claude-3.5-sonnet", ModelDetector.send(:detect_claude_model)
    end
  end

  test "detect_claude_model reads model from preferences.model in config" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".claude", "settings.json")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, JSON.generate({ "preferences" => { "model" => "claude-3-opus" } }))

      assert_equal "claude-3-opus", ModelDetector.send(:detect_claude_model)
    end
  end

  test "detect_claude_model returns default when config missing" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      assert_equal "claude", ModelDetector.send(:detect_claude_model)
    end
  end

  test "detect_claude_model returns default for malformed JSON" do
    Dir.mktmpdir do |tmp_home|
      ENV["HOME"] = tmp_home
      config_file = File.join(tmp_home, ".claude", "settings.json")
      FileUtils.mkdir_p(File.dirname(config_file))
      File.write(config_file, "{ invalid json }")

      assert_equal "claude", ModelDetector.send(:detect_claude_model)
    end
  end
end
