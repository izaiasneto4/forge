require "test_helper"

class ApplicationHelperTest < ActionView::TestCase
  test "module is available to views" do
    assert_includes self.class.included_modules, ApplicationHelper
  end
end
