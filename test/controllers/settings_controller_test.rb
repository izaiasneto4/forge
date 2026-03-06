require "test_helper"

class SettingsControllerTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    Setting.delete_all
  end

  teardown do
    Setting.delete_all
  end

  test "should get edit" do
    get edit_settings_path
    assert_response :success
  end

  test "update with valid folder path" do
    patch settings_path, params: { repos_folder: "/tmp" }
    assert_redirected_to edit_settings_path
    assert_equal "Settings updated", flash[:notice]
    assert_equal "/tmp", Setting.repos_folder
  end

  test "update with invalid folder path" do
    patch settings_path, params: { repos_folder: "/nonexistent/path/xyz" }
    assert_redirected_to edit_settings_path
    assert_equal "Invalid folder path", flash[:alert]
  end

  test "update with empty folder path" do
    patch settings_path, params: { repos_folder: "" }
    assert_redirected_to edit_settings_path
    assert_equal "Settings updated", flash[:notice]
  end

  test "update with valid cli_client" do
    patch settings_path, params: { default_cli_client: "claude" }
    assert_redirected_to edit_settings_path
    assert_equal "Settings updated", flash[:notice]
    assert_equal "claude", Setting.default_cli_client
  end

  test "update with both folder and cli_client" do
    patch settings_path, params: {
      repos_folder: "/tmp",
      default_cli_client: "codex"
    }
    assert_redirected_to edit_settings_path
    assert_equal "Settings updated", flash[:notice]
    assert_equal "/tmp", Setting.repos_folder
    assert_equal "codex", Setting.default_cli_client
  end

  test "theme updates preference and returns JSON" do
    patch theme_settings_path, params: { theme_preference: "dark" }, as: :json

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "dark", body["theme_preference"]
    assert_equal "dark", Setting.theme_preference
  end

  test "theme returns 422 for invalid value" do
    patch theme_settings_path, params: { theme_preference: "sepia" }, as: :json

    assert_response :unprocessable_entity
    body = JSON.parse(response.body)
    assert_equal "Invalid theme_preference", body["error"]
    assert_nil Setting.theme_preference
  end

  test "pick_folder exists and returns JSON" do
    FolderPickerService.expects(:call).returns("/tmp")

    post pick_folder_settings_path, as: :json
    assert_response :success
    json_response = JSON.parse(response.body)
    assert_equal "/tmp", json_response["path"]
  end

  test "pick_folder uses FolderPickerService" do
    controller_code = File.read(Rails.root.join("app/controllers/settings_controller.rb"))

    # Check that we're using FolderPickerService
    assert_includes controller_code, "FolderPickerService", "Should use FolderPickerService"

    # Check that we're not using Open3 directly in controller
    refute_includes controller_code, "Open3", "Should not use Open3 directly in controller"

    # Check that we're not using backticks for osascript
    refute_includes controller_code, "`osascript", "Should not use backticks for osascript command"
  end
end
