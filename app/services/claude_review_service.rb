# Deprecated: Use CodeReviewService.for(cli_client: "claude", ...) instead
class ClaudeReviewService
  Error = CodeReviewService::Error

  def initialize(worktree_path:, pull_request:)
    @service = CodeReviewService.for(
      cli_client: "claude",
      worktree_path: worktree_path,
      pull_request: pull_request
    )
  end

  def run_review
    @service.run_review
  end

  def run_review_streaming(&block)
    @service.run_review_streaming(&block)
  end
end
