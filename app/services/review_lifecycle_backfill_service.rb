class ReviewLifecycleBackfillService
  EVENT_MAP = {
    "CHANGES_REQUESTED" => "REQUEST_CHANGES",
    "APPROVED" => "APPROVE",
    "COMMENTED" => "COMMENT"
  }.freeze

  def initialize(github_service: GithubCliService.new, io: $stdout)
    @github_service = github_service
    @io = io
  end

  def run(apply: false, limit: nil)
    scope = PullRequest.reviewed_by_me
      .joins(:review_task)
      .includes(:review_task)
      .where(review_tasks: { state: "reviewed", submission_status: "submitted" })
      .order(updated_at: :desc)
    scope = scope.limit(limit) if limit.present?

    processed = 0
    updated = 0
    skipped = 0
    failed = 0

    log "Backfill #{apply ? 'apply' : 'dry-run'} mode. candidates=#{scope.count}"

    scope.find_each do |pull_request|
      processed += 1
      action = plan_action(pull_request)

      if action[:type] == :noop
        skipped += 1
        log format_line(pull_request, action, "skip")
        next
      end

      log format_line(pull_request, action, apply ? "apply" : "plan")

      next unless apply

      begin
        apply_action!(pull_request, action)
        updated += 1
      rescue => e
        failed += 1
        log "ERROR ##{pull_request.number}: #{e.class} #{e.message}"
      end
    end

    summary = {
      processed: processed,
      updated: updated,
      skipped: skipped,
      failed: failed,
      mode: apply ? "apply" : "dry-run"
    }
    log "Summary: #{summary.to_json}"
    summary
  end

  private

  def plan_action(pull_request)
    if @github_service.review_requested_for_me?(pull_request)
      return {
        type: :reset_to_pending,
        reason: "review requested again"
      }
    end

    latest_state = @github_service.latest_my_review_state(pull_request)
    submitted_event = EVENT_MAP[latest_state]
    return { type: :noop, reason: "no mappable latest review state (#{latest_state || 'none'})" } if submitted_event.blank?

    if submitted_event == "REQUEST_CHANGES"
      return {
        type: :move_to_waiting,
        submitted_event: submitted_event,
        reason: "latest review state #{latest_state}"
      }
    end

    {
      type: :normalize_reviewed,
      submitted_event: submitted_event,
      reason: "latest review state #{latest_state}"
    }
  rescue => e
    { type: :noop, reason: "github lookup failed: #{e.class}" }
  end

  def apply_action!(pull_request, action)
    task = pull_request.review_task
    return unless task.present?

    ActiveRecord::Base.transaction do
      case action[:type]
      when :reset_to_pending
        task.move_backward!("pending_review")
        task.update!(submission_status: "pending_submission", submitted_at: nil, submitted_event: nil)
        pull_request.update!(review_status: "pending_review")
      when :move_to_waiting
        task.update!(state: "waiting_implementation", submitted_event: action[:submitted_event])
        pull_request.update!(review_status: "waiting_implementation")
      when :normalize_reviewed
        task.update!(state: "reviewed", submitted_event: action[:submitted_event])
        pull_request.update!(review_status: "reviewed_by_me") unless pull_request.review_status == "reviewed_by_me"
      end
    end
  end

  def format_line(pull_request, action, prefix)
    "##{pull_request.number} #{prefix}: #{action[:type]} (#{action[:reason]})"
  end

  def log(message)
    @io.puts(message)
  end
end
