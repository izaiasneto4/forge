ENV["RAILS_ENV"] ||= "test"
unless ENV["SKIP_COVERAGE"] == "1"
  require "simplecov"

  SimpleCov.start do
    enable_coverage :branch
    primary_coverage :branch

    track_files "{app/controllers/api/v1/**/*.rb,app/services/pull_request_url_parser.rb,app/services/repo_slug_resolver.rb,app/services/repo_switch_resolver.rb,lib/forge/**/*.rb}"

    add_filter do |source_file|
      tracked = [
        %r{^app/controllers/api/v1/},
        %r{^app/services/pull_request_url_parser\.rb$},
        %r{^app/services/repo_slug_resolver\.rb$},
        %r{^app/services/repo_switch_resolver\.rb$},
        %r{^lib/forge/}
      ]

      !tracked.any? { |pattern| source_file.filename.sub("#{SimpleCov.root}/", "").match?(pattern) }
    end

    minimum_coverage line: 100, branch: 100
    minimum_coverage_by_file 100
  end
end

require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors) unless ENV["COVERAGE_GATE"] == "1"

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    # fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end

require "mocha/minitest"
