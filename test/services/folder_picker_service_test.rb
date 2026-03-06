require "test_helper"

class FolderPickerServiceTest < ActiveSupport::TestCase
  test "call returns nil when osascript fails" do
    Open3.expects(:capture3).with("osascript", "-e", includes("choose folder"))
      .returns([ "", "failed", stub(success?: false) ])

    assert_nil FolderPickerService.call
  end

  test "call returns stripped path when chooser succeeds with existing directory" do
    Dir.mktmpdir do |dir|
      Open3.expects(:capture3).with("osascript", "-e", includes("choose folder"))
        .returns([ "#{dir}/\n", "", stub(success?: true) ])

      assert_equal dir, FolderPickerService.call
    end
  end

  test "call returns nil when chooser succeeds with blank result" do
    Open3.expects(:capture3).with("osascript", "-e", includes("choose folder"))
      .returns([ " \n", "", stub(success?: true) ])

    assert_nil FolderPickerService.call
  end

  test "call returns nil when chooser succeeds with non-existent directory" do
    Open3.expects(:capture3).with("osascript", "-e", includes("choose folder"))
      .returns([ "/tmp/does-not-exist/\n", "", stub(success?: true) ])

    assert_nil FolderPickerService.call
  end

  test "call returns nil when osascript raises" do
    Open3.expects(:capture3).raises(StandardError, "boom")
    Rails.logger.expects(:error).with("FolderPickerService: boom")

    assert_nil FolderPickerService.call
  end

  test "service class responds to call" do
    assert FolderPickerService.respond_to?(:call)
  end

  test "service instance responds to call" do
    service = FolderPickerService.new
    assert service.respond_to?(:call)
  end

  test "class method call accepts prompt keyword" do
    assert_respond_to FolderPickerService, :call
  end

  test "build_applescript returns valid AppleScript" do
    service = FolderPickerService.new
    script = service.send(:build_applescript, "Select a folder")

    assert_includes script, "Select a folder"
    assert_includes script, "tell application \"System Events\""
    assert_includes script, "choose folder"
    assert_includes script, "POSIX path of selectedFolder"
  end

  test "build_applescript escapes quotes in prompt" do
    service = FolderPickerService.new
    script = service.send(:build_applescript, 'Folder with "quotes"')

    assert_includes script, "Folder with \"quotes\""
  end

  test "build_applescript handles unicode characters in prompt" do
    service = FolderPickerService.new
    script = service.send(:build_applescript, "Seleção de pasta")

    assert_includes script, "Seleção de pasta"
  end

  test "build_applescript uses default prompt when not provided" do
    service = FolderPickerService.new
    script = service.send(:build_applescript, "Select your repositories folder")

    assert_includes script, "Select your repositories folder"
  end

  test "build_applescript handles empty prompt" do
    service = FolderPickerService.new
    script = service.send(:build_applescript, "")

    assert_includes script, "choose folder"
  end

  test "build_applescript handles very long prompt" do
    long_prompt = "x" * 500
    service = FolderPickerService.new
    script = service.send(:build_applescript, long_prompt)

    assert_includes script, long_prompt
  end

  test "build_applescript handles special characters in prompt" do
    service = FolderPickerService.new
    script = service.send(:build_applescript, "Select folder: \\n\\t\\r")

    assert_includes script, "choose folder"
  end

  test "call method accepts prompt keyword" do
    service = FolderPickerService.new
    method = service.method(:call)

    assert_equal 1, method.parameters.size
    assert_equal :key, method.parameters.first.first
    assert_equal :prompt, method.parameters.first.last
  end

  test "class call method accepts prompt keyword" do
    method = FolderPickerService.method(:call)

    assert_equal 1, method.parameters.size
    assert_equal :key, method.parameters.first.first
    assert_equal :prompt, method.parameters.first.last
  end

  test "service is thread-safe" do
    services = Array.new(5) { FolderPickerService.new }
    services.each do |service|
      assert_respond_to service, :call
    end
  end
end
