class Api::V1::SettingsController < Api::V1::BaseController
  def show
    render_ok(Api::V1::UiPayloads::Settings.new.as_json)
  end

  def update
    folder_path = params[:repos_folder]
    cli_client = params[:default_cli_client]

    if folder_path.present? && !Dir.exist?(folder_path)
      return render_error("invalid_input", "Invalid folder path", :unprocessable_entity)
    end

    Setting.repos_folder = folder_path if params.key?(:repos_folder)
    Setting.default_cli_client = cli_client if cli_client.present?
    Setting.auto_submit_enabled = ActiveModel::Type::Boolean.new.cast(params[:auto_submit_enabled])

    render_ok(
      {
        message: "Settings updated",
        settings: Api::V1::UiPayloads::Settings.new.as_json
      }
    )
  end

  def pick_folder
    render_ok(path: FolderPickerService.call)
  end

  def theme
    theme_preference = params[:theme_preference].presence

    unless theme_preference && Setting::VALID_THEME_PREFERENCES.include?(theme_preference)
      return render_error("invalid_input", "Invalid theme_preference", :unprocessable_entity)
    end

    Setting.theme_preference = theme_preference

    render_ok(
      {
        message: "Theme updated",
        settings: Api::V1::UiPayloads::Settings.new.as_json
      }
    )
  end
end
