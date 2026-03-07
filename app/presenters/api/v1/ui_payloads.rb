module Api
  module V1
    module UiPayloads
      class Base
        private

        def helper
          ApplicationController.helpers
        end

        def sync_status
          {
            last_synced_at: Setting.last_synced_at&.iso8601,
            seconds_until_sync_allowed: Setting.seconds_until_sync_allowed,
            sync_needed: Setting.sync_needed?
          }
        end

        def current_repo_payload
          repo_path = Setting.current_repo
          repo_slug = RepoSlugResolver.from_path(repo_path)

          {
            path: repo_path,
            slug: repo_slug,
            name: repo_path.present? ? File.basename(repo_path.to_s).sub(%r{/$}, "") : nil
          }
        end

        def repositories_payload
          repos_folder = Setting.repos_folder
          repositories = repos_folder.present? ? RepoScannerService.new(repos_folder).scan : []

          {
            repos_folder: repos_folder,
            current_repo_path: Setting.current_repo,
            current_repo_slug: RepoSlugResolver.from_path(Setting.current_repo),
            items: repositories.map { |repo| repository_payload(repo) }
          }
        end

        def repository_payload(repo)
          {
            name: repo[:name],
            path: repo[:path],
            branch: repo[:branch],
            slug: RepoSlugResolver.from_path(repo[:path]),
            current: repo[:path] == Setting.current_repo
          }
        end

        def pull_request_payload(pull_request)
          {
            id: pull_request.id,
            number: pull_request.number,
            title: pull_request.title,
            url: pull_request.url,
            author: pull_request.author,
            author_avatar: pull_request.author_avatar,
            description: pull_request.description,
            repo_owner: pull_request.repo_owner,
            repo_name: pull_request.repo_name,
            repo_full_name: pull_request.repo_full_name,
            review_status: pull_request.review_status,
            archived: pull_request.archived?,
            created_at_github: pull_request.created_at_github&.iso8601,
            updated_at_github: pull_request.updated_at_github&.iso8601,
            review_task: pull_request.review_task.present? ? review_task_payload(pull_request.review_task, include_pull_request: false) : nil
          }
        end

        def review_task_payload(review_task, include_pull_request: true)
          {
            id: review_task.id,
            state: review_task.state,
            archived: review_task.archived?,
            ai_model: review_task.ai_model,
            cli_client: review_task.cli_client,
            review_type: review_task.review_type,
            retry_count: review_task.retry_count,
            max_retry_attempts: ReviewTask::MAX_RETRY_ATTEMPTS,
            can_retry: review_task.can_retry?,
            queued_at: review_task.queued_at&.iso8601,
            queue_position: review_task.queue_position,
            started_at: review_task.started_at&.iso8601,
            completed_at: review_task.completed_at&.iso8601,
            failure_reason: review_task.failure_reason,
            submission_status: review_task.submission_status,
            submitted_at: review_task.submitted_at&.iso8601,
            submitted_event: review_task.submitted_event,
            has_review_history: review_task.has_review_history?,
            current_iteration_number: review_task.current_iteration_number,
            swarm_review: review_task.swarm_review?,
            pull_request: include_pull_request ? compact_pull_request_payload(review_task.pull_request) : nil
          }
        end

        def compact_pull_request_payload(pull_request)
          {
            id: pull_request.id,
            number: pull_request.number,
            title: pull_request.title,
            url: pull_request.url,
            author: pull_request.author,
            author_avatar: pull_request.author_avatar,
            repo_name: pull_request.repo_name,
            repo_full_name: pull_request.repo_full_name,
            review_status: pull_request.review_status
          }
        end

        def review_comment_payload(comment)
          {
            id: comment.id,
            title: comment.title,
            severity: comment.severity,
            status: comment.status,
            body: comment.body,
            body_html: markdown_html(comment.body),
            file_path: comment.file_path,
            line_number: comment.line_number,
            location: comment.location,
            resolution_note: comment.resolution_note,
            actionable: comment.actionable?
          }
        end

        def parsed_review_item_payload(item)
          suggested_fix_is_code = helper.code_suggestion?(item.suggested_fix)

          {
            title: item.title,
            severity: item.severity,
            severity_emoji: helper.severity_emoji(item.severity),
            file: item.file,
            lines: item.lines,
            location: [ item.file, item.lines.presence ].compact.join(":"),
            comment: item.comment,
            comment_html: markdown_html(item.comment),
            suggested_fix: item.suggested_fix,
            suggested_fix_is_code: suggested_fix_is_code,
            suggested_fix_html: suggested_fix_is_code ? code_block_html(item.suggested_fix, helper.detect_language_from_file(item.file)) : markdown_html(item.suggested_fix)
          }
        end

        def review_iteration_payload(iteration)
          parsed_items = ReviewOutputParser.parse(iteration.review_output)

          {
            id: iteration.id,
            iteration_number: iteration.iteration_number,
            cli_client: iteration.cli_client,
            review_type: iteration.review_type,
            ai_model: iteration.ai_model,
            from_state: iteration.from_state,
            to_state: iteration.to_state,
            started_at: iteration.started_at&.iso8601,
            completed_at: iteration.completed_at&.iso8601,
            duration_seconds: iteration.duration_seconds,
            parsed_review_items: parsed_items.map { |item| parsed_review_item_payload(item) },
            raw_output: iteration.review_output,
            raw_output_html: markdown_html(iteration.review_output),
            output_mode: parsed_items.any? ? "parsed_review_items" : (iteration.review_output.present? ? "raw_output" : "empty")
          }
        end

        def log_payload(log)
          {
            id: log.id,
            log_type: log.log_type,
            message: log.message,
            created_at: log.created_at.iso8601
          }
        end

        def markdown_html(text)
          return nil if text.blank?

          helper.render_markdown(text).to_s
        end

        def code_block_html(text, language = nil)
          return nil if text.blank?

          helper.render_code_block(text, language).to_s
        end
      end

      class Bootstrap < Base
        def as_json(*)
          header = HeaderPresenter.new

          {
            app: {
              name: "Forge",
              cli_clients: Setting::CLI_CLIENTS,
              valid_theme_preferences: Setting::VALID_THEME_PREFERENCES
            },
            current_repo: current_repo_payload,
            settings: {
              default_cli_client: Setting.default_cli_client,
              auto_submit_enabled: Setting.auto_submit_enabled?,
              only_requested_reviews: Setting.only_requested_reviews?,
              theme_preference: Setting.theme_preference,
              github_login: Setting.github_login
            },
            counts: {
              pending_review: header.pending_count,
              in_review: header.in_review_count
            },
            sync_status: sync_status
          }
        end
      end

      class PullRequestBoard < Base
        STATUSES = %w[pending_review in_review reviewed_by_me waiting_implementation reviewed_by_others review_failed].freeze

        def initialize
          @presenter = PullRequestIndexPresenter.new
        end

        def as_json(*)
          columns = @presenter.columns

          {
            current_repo: current_repo_payload,
            repositories: repositories_payload,
            settings: {
              only_requested_reviews: Setting.only_requested_reviews?,
              current_user_login: Setting.github_login
            },
            sync_status: sync_status,
            counts: board_counts(columns),
            total_count: @presenter.total_count,
            columns: columns.transform_values { |items| items.map { |pull_request| pull_request_payload(pull_request) } }
          }
        end

        private

        def board_counts(columns)
          STATUSES.index_with { |status| columns.fetch(status.to_sym, []).size }
        end
      end

      class ReviewTaskBoard < Base
        STATES = %w[queued pending_review in_review reviewed waiting_implementation done failed_review].freeze

        def initialize
          @review_tasks = ReviewTask.includes(:pull_request, :agent_logs, :review_iterations).order(created_at: :desc)
        end

        def as_json(*)
          grouped = {
            queued: @review_tasks.queued,
            pending_review: @review_tasks.pending_review,
            in_review: @review_tasks.in_review,
            reviewed: @review_tasks.reviewed,
            waiting_implementation: @review_tasks.waiting_implementation,
            done: @review_tasks.done,
            failed_review: @review_tasks.failed_review
          }

          {
            current_repo: current_repo_payload,
            counts: STATES.index_with { |state| grouped.fetch(state.to_sym, []).size },
            total_count: grouped.values.sum(&:size),
            columns: grouped.transform_values { |items| items.map { |task| review_task_payload(task) } }
          }
        end
      end

      class ReviewTaskDetail < Base
        def initialize(review_task)
          @review_task = review_task
        end

        def as_json(*)
          comments = @review_task.review_comments.by_severity.to_a
          parsed_items = @review_task.parsed_review_items
          logs = @review_task.agent_logs.recent.to_a

          {
            current_repo: current_repo_payload,
            task: review_task_payload(@review_task),
            submission: submission_payload(comments),
            comments: comments.map { |comment| review_comment_payload(comment) },
            review_history: @review_task.review_history.map { |iteration| review_iteration_payload(iteration) },
            parsed_review_items: parsed_items.map { |item| parsed_review_item_payload(item) },
            raw_output: @review_task.review_output,
            raw_output_html: markdown_html(@review_task.review_output),
            live_logs: logs.map { |log| log_payload(log) },
            content_mode: content_mode(comments, parsed_items),
            meta: {
              formatted_duration: helper.format_review_duration(@review_task.started_at, @review_task.completed_at)
            }
          }
        end

        private

        def submission_payload(comments)
          pending_comments = comments.select(&:pending?)
          severity_counts = pending_comments.group_by(&:severity).transform_values(&:count)

          {
            auto_submit_enabled: Setting.auto_submit_enabled?,
            pending_comment_count: pending_comments.count,
            severity_counts: {
              critical: severity_counts["critical"] || 0,
              major: severity_counts["major"] || 0,
              minor: severity_counts["minor"] || 0,
              suggestion: severity_counts["suggestion"] || 0,
              nitpick: severity_counts["nitpick"] || 0
            },
            allowed_events: %w[COMMENT APPROVE REQUEST_CHANGES]
          }
        end

        def content_mode(comments, parsed_items)
          return "comments" if comments.any?
          return "parsed_review_items" if parsed_items.any?
          return "raw_output" if @review_task.review_output.present?
          return "live_logs" if @review_task.in_review? || @review_task.pending_review?

          "empty"
        end
      end

      class Settings < Base
        def as_json(*)
          {
            repos_folder: Setting.repos_folder,
            current_repo: current_repo_payload,
            default_cli_client: Setting.default_cli_client,
            auto_submit_enabled: Setting.auto_submit_enabled?,
            theme_preference: Setting.theme_preference,
            cli_clients: Setting::CLI_CLIENTS,
            valid_theme_preferences: Setting::VALID_THEME_PREFERENCES
          }
        end
      end

      class Repositories < Base
        def as_json(*)
          repositories_payload
        end
      end
    end
  end
end
