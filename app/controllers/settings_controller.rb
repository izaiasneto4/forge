class SettingsController < ApplicationController
  def edit
    @repos_folder = Setting.repos_folder
    @default_cli_client = Setting.default_cli_client
    @auto_submit_enabled = Setting.auto_submit_enabled?
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
    Setting.auto_submit_enabled = params[:auto_submit_enabled] == "1"

    redirect_to edit_settings_path, notice: "Settings updated"
  end

  def pick_folder
    path = FolderPickerService.call

    render json: { path: path }
  end
end
