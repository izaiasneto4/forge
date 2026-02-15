ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "warden/test/helpers"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    # Disabled for now due to Devise test helper issues with parallelization
    # parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end

# Include Devise test helpers for controller tests
class ActionDispatch::IntegrationTest
  include Warden::Test::Helpers
  include Devise::Test::IntegrationHelpers
  Warden.test_mode!
end

require "mocha/minitest"
