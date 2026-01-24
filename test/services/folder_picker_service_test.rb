require "test_helper"

class FolderPickerServiceTest < ActiveSupport::TestCase
  test "call returns nil on non-macOS platforms" do
    skip("Requires macOS integration test") unless RUBY_PLATFORM =~ /darwin/
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
