require "test_helper"

class FrontendRoutesTest < ActionDispatch::IntegrationTest
  test "mailbox and pull request paths serve the frontend shell" do
    paths = [ "/inbox", "/reviewing", "/waiting/12", "/mine", "/settled/7", "/new" ]

    paths.each do |path|
      get path

      assert_response :success, path
      assert_includes response.body, %(<div id="root"></div>), path
    end
  end

  test "unknown mailboxes are not routed to the frontend" do
    assert_raises(ActionController::RoutingError) { Rails.application.routes.recognize_path("/archive") }
  end
end
