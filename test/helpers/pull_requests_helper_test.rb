require "test_helper"

class PullRequestsHelperTest < ActionView::TestCase
  test "module is available to views" do
    assert_includes self.class.included_modules, PullRequestsHelper
  end
end
