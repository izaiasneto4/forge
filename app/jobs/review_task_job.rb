class ReviewTaskJob < ApplicationJob
  queue_as :default

  def perform(review_task_id, is_retry: false)
    review_task = ReviewTask.find(review_task_id)
    pull_request = review_task.pull_request
    repo_path = Setting.current_repo

    return unless repo_path.present?

    # Only clear logs on first attempt, not retries
    unless is_retry
      review_task.clear_logs!
      review_task.reset_retry_state!
    end

    log_retry_info(review_task, is_retry)
    broadcast_preparing(review_task)

    worktree_service = WorktreeService.new(repo_path: repo_path)

    begin
      review_task.add_log("Fetching PR from GitHub...", log_type: "status")
      worktree_path = worktree_service.create_for_pr(pull_request)
      review_task.update!(worktree_path: worktree_path)
      review_task.add_log("Worktree ready at #{worktree_path}", log_type: "status")

      # Only mark as in_review AFTER worktree is ready
      review_task.start_review!

      review_service = CodeReviewService.for(
        cli_client: review_task.cli_client,
        worktree_path: worktree_path,
        pull_request: pull_request,
        review_type: review_task.review_type
      )

      # Capture model information before starting the review
      detected_model = review_service.detect_model
      review_task.update!(ai_model: detected_model)
      review_task.add_log("Using model: #{detected_model}", log_type: "status") if detected_model != "unknown"

      review_task.add_log("Running #{review_task.cli_client} review...", log_type: "status")

      output_buffer = []
      review_service.run_review_streaming do |line|
        output_buffer << line
        trimmed = line.chomp
        review_task.add_log(trimmed, log_type: "output") if trimmed.present?
      end

      full_output = output_buffer.join

      # Validate review output before marking complete
      validate_review_output!(full_output, review_task)

      review_task.add_log("Review completed!", log_type: "status")
      review_task.reset_retry_state!
      review_task.complete_review!(full_output)

      # Parse output and build review comments
      comments = ReviewCommentBuilder.persist_for_review_task(review_task)
      review_task.add_log("Created #{comments.size} review comments", log_type: "status") if comments.any?

      broadcast_completion(review_task)

    rescue WorktreeService::NetworkError => e
      handle_transient_error(review_task, e, "Network error")
    rescue ReviewErrors::TransientError => e
      handle_transient_error(review_task, e, e.class.name.demodulize)
    rescue ReviewErrors::PermanentError => e
      handle_permanent_error(review_task, e)
    rescue => e
      handle_unknown_error(review_task, e)
    ensure
      worktree_service.cleanup_worktree(review_task.worktree_path) if review_task.worktree_path.present?
      schedule_next_queued_review
    end
  end

  def schedule_next_queued_review
    return unless Setting.auto_review_mode?

    ProcessReviewQueueJob.set(wait: Setting.auto_review_delay.seconds).perform_later
  end

  private

  def log_retry_info(review_task, is_retry)
    if is_retry
      review_task.add_log(
        "Retry attempt #{review_task.retry_count + 1}/#{ReviewTask::MAX_RETRY_ATTEMPTS}...",
        log_type: "status"
      )
    else
      review_task.add_log("Starting review...", log_type: "status")
    end
  end

  def validate_review_output!(output, review_task)
    if output.blank?
      raise ReviewErrors::ValidationError, "Review produced empty output"
    end

    # Check for incomplete/truncated output patterns
    if output.include?("Error:") && output.lines.size < 5
      classified = ReviewErrors::ErrorClassifier.classify(output)
      raise classified
    end
  end

  def handle_transient_error(review_task, error, error_type)
    Rails.logger.error("Review task #{review_task.id} #{error_type}: #{error.message}")
    review_task.add_log("#{error_type}: #{error.message}", log_type: "error")

    if review_task.can_retry?
      schedule_retry(review_task, error)
    else
      finalize_as_failed(review_task, error, "after #{review_task.retry_count} retries")
    end
  end

  def handle_permanent_error(review_task, error)
    Rails.logger.error("Review task #{review_task.id} permanent failure: #{error.message}")
    review_task.add_log("Permanent error: #{error.message}", log_type: "error")
    review_task.add_log("This error cannot be resolved by retrying", log_type: "error")

    finalize_as_failed(review_task, error, "permanent failure")
  end

  def handle_unknown_error(review_task, error)
    Rails.logger.error("Review task #{review_task.id} unknown error: #{error.message}")

    # Classify unknown error to determine if retryable
    classified = ReviewErrors::ErrorClassifier.classify(error)

    if classified.retryable? && review_task.can_retry?
      review_task.add_log("Error (will retry): #{error.message}", log_type: "error")
      schedule_retry(review_task, error)
    else
      review_task.add_log("Error: #{error.message}", log_type: "error")
      finalize_as_failed(review_task, error, classified.retryable? ? "retries exhausted" : "non-retryable")
    end
  end

  def schedule_retry(review_task, error)
    review_task.increment_retry!(error.message)
    backoff = review_task.backoff_seconds

    review_task.add_log(
      "Scheduling retry #{review_task.retry_count}/#{ReviewTask::MAX_RETRY_ATTEMPTS} in #{backoff}s...",
      log_type: "status"
    )

    broadcast_retry_scheduled(review_task, backoff)

    # Re-enqueue with exponential backoff
    ReviewTaskJob.set(wait: backoff.seconds).perform_later(review_task.id, is_retry: true)
  end

  def finalize_as_failed(review_task, error, context)
    failure_message = "Review failed (#{context}): #{error.message}"
    review_task.add_log(failure_message, log_type: "error")
    review_task.mark_failed!(failure_message)
    broadcast_completion(review_task, failed: true)
  end

  def broadcast_completion(review_task, failed: false)
    ActionCable.server.broadcast(
      "review_task_#{review_task.id}_logs",
      {
        type: failed ? "failed" : "completed",
        review_task_id: review_task.id,
        state: review_task.state
      }
    )
  end

  def broadcast_retry_scheduled(review_task, backoff_seconds)
    ActionCable.server.broadcast(
      "review_task_#{review_task.id}_logs",
      {
        type: "retry_scheduled",
        review_task_id: review_task.id,
        retry_count: review_task.retry_count,
        max_retries: ReviewTask::MAX_RETRY_ATTEMPTS,
        backoff_seconds: backoff_seconds
      }
    )
  end

  def broadcast_preparing(review_task)
    ActionCable.server.broadcast(
      "review_task_#{review_task.id}_logs",
      {
        type: "preparing",
        review_task_id: review_task.id,
        state: review_task.state
      }
    )
  end
end
