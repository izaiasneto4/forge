module Sync
  class Orchestrator
    def initialize(repo_path: nil)
      @repo_path = repo_path || Setting.current_repo
    end

    def call
      SyncMode.with_active do
        Sync::Engine.new(repo_path: @repo_path).call
      end
    end
  end
end
