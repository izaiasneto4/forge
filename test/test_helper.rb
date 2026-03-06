ENV["RAILS_ENV"] ||= "test"
unless ENV["SKIP_COVERAGE"] == "1"
  require "simplecov"

  coverage_audit = ENV["FULL_COVERAGE_AUDIT"] == "1"
  tracked_patterns = if coverage_audit
    %w[
      app/channels/**/*.rb
      app/configuration/**/*.rb
      app/controllers/**/*.rb
      app/helpers/**/*.rb
      app/jobs/**/*.rb
      app/models/**/*.rb
      app/presenters/**/*.rb
      app/services/**/*.rb
      app/validators/**/*.rb
      lib/**/*.rb
    ]
  else
    %w[
      app/controllers/api/v1/**/*.rb
      app/services/pull_request_url_parser.rb
      app/services/repo_slug_resolver.rb
      app/services/repo_switch_resolver.rb
      lib/forge/**/*.rb
    ]
  end

  SimpleCov.start do
    enable_coverage :branch
    primary_coverage :branch

    track_files "{#{tracked_patterns.join(',')}}"

    tracked = tracked_patterns.map do |pattern|
      regexp = Regexp.escape(pattern)
        .gsub("\\*\\*/", "(?:.+/)?")
        .gsub("\\*", "[^/]+")
      %r{\A#{regexp}\z}
    end

    add_filter do |source_file|
      relative_path = source_file.filename.delete_prefix("#{SimpleCov.root}/")
      !tracked.any? { |pattern| relative_path.match?(pattern) }
    end

    unless coverage_audit
      minimum_coverage line: 100, branch: 100
      minimum_coverage_by_file 100
    end
  end
end

require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    unless ENV["COVERAGE_GATE"] == "1"
      if ENV["TEST_WORKERS"].present?
        parallelize(workers: ENV["TEST_WORKERS"].to_i)
      elsif ActiveRecord::Base.connection_db_config.adapter != "sqlite3"
        parallelize(workers: :number_of_processors)
      end
    end

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    # fixtures :all

    # Add more helper methods to be used by all tests here...
  end
end

require "mocha/minitest"
