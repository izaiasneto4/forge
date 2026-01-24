class SettingsController < ApplicationController
  def edit
    @repos_folder = Setting.repos_folder
    @default_cli_client = Setting.default_cli_client
  end

  def update
    folder_path = params[:repos_folder]
    cli_client = params[:default_cli_client]

    if folder_path.present? && !Dir.exist?(folder_path)
      redirect_to edit_settings_path, alert: "Invalid folder path"
      return
    end

    Setting.repos_folder = folder_path if folder_path.present?
    Setting.default_cli_client = cli_client if cli_client.present?

    redirect_to edit_settings_path, notice: "Settings updated"
  end

  def pick_folder
    script = <<~APPLESCRIPT
      tell application "System Events"
        activate
        set selectedFolder to choose folder with prompt "Select your repositories folder"
        return POSIX path of selectedFolder
      end tell
    APPLESCRIPT

    result, stderr, status = Open3.capture3("osascript", "-e", script)

    if status.success? && result.present? && Dir.exist?(result.strip)
      render json: { path: result.strip.chomp("/") }
    else
      render json: { path: nil }
    end
  end
end
