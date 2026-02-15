require "test_helper"

class ImportmapCompatibilityTest < ActiveSupport::TestCase
  test "pins @hotwired/turbo when controllers import it" do
    controller_files = Dir[Rails.root.join("app/javascript/controllers/*.js")]
    turbo_import_users = controller_files.select do |file|
      File.read(file).include?('from "@hotwired/turbo"')
    end

    return if turbo_import_users.empty?

    importmap = File.read(Rails.root.join("config/importmap.rb"))
    assert_includes importmap, 'pin "@hotwired/turbo"',
      "Controllers import @hotwired/turbo but config/importmap.rb does not pin it."
  end
end
