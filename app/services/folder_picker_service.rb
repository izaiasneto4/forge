require "open3"
require "logger"

class FolderPickerService
  def self.call(prompt: "Select your repositories folder")
    new.call(prompt:)
  end

  def call(prompt: "Select your repositories folder")
    script = build_applescript(prompt)

    result, stderr, status = Open3.capture3("osascript", "-e", script)

    return nil unless status.success?
    return nil if result.blank?

    path = result.strip.chomp("/")
    return path if Dir.exist?(path)

    nil
  rescue StandardError => e
    Rails.logger.error("FolderPickerService: #{e.message}")
    nil
  end

  private

  def build_applescript(prompt)
    <<~APPLESCRIPT
      tell application "System Events"
        activate
        set selectedFolder to choose folder with prompt "#{prompt}"
        return POSIX path of selectedFolder
      end tell
    APPLESCRIPT
  end
end
