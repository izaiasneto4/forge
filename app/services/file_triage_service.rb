require "json"
require "open3"

class FileTriageService
  class Error < StandardError; end

  SKIP_BASENAMES = %w[
    package-lock.json
    yarn.lock
    pnpm-lock.yaml
    Gemfile.lock
    Cargo.lock
    poetry.lock
    composer.lock
  ].freeze

  SKIP_EXTENSIONS = %w[.min.js .min.css .map .lock].freeze

  SKIP_PATH_PARTS = %w[vendor/ node_modules/ dist/ build/ .forge-worktrees/].freeze

  PATCH_EXCERPT_CHARS = 2_500
  BODY_EXCERPT_CHARS = 800

  FILE_QUESTIONS = {
    "core_to_change" => {
      "type" => "score",
      "instructions" => "How central is this file to what the pull request is building?",
      "criteria" => [
        "Peripheral or unrelated to the main change",
        "Supporting file with light involvement",
        "Moderately important to understanding the change",
        "Important part of the change",
        "Core file that defines what this PR does"
      ]
    },
    "regression_risk" => {
      "type" => "score",
      "instructions" => "If this file is wrong, how severe is the production or user impact?",
      "criteria" => [
        "Almost no user or production impact",
        "Low impact, easy to notice and fix",
        "Moderate impact in a limited area",
        "High impact across an important path",
        "Critical: auth, money, data loss, or widespread breakage"
      ]
    },
    "role" => {
      "type" => "choice",
      "instructions" => "Which role best describes this changed file in the PR?",
      "criteria" => {
        "entrypoint" => "Controllers, routes, CLI entrypoints, or main handlers that start the flow.",
        "domain_logic" => "Business rules, services, use-cases, or core algorithms.",
        "persistence" => "Models, migrations, queries, or storage adapters.",
        "api_contract" => "Public API schemas, serializers, GraphQL types, or shared interfaces.",
        "test" => "Unit, integration, or end-to-end tests.",
        "config" => "Config, env wiring, feature flags, or infrastructure manifests.",
        "chore" => "Formatting, renames, docs, or low-signal churn.",
        "generated" => "Generated code, lockfiles, or vendored artifacts."
      }
    },
    "must_read_by_hand" => {
      "type" => "noul",
      "instructions" => "Should a human reviewer read this file by hand even on a short review budget?",
      "criteria" => {
        "true" => "Yes — missing this file would leave a dangerous blind spot.",
        "false" => "No — skim or skip is fine if time is limited."
      }
    }
  }.freeze

  def initialize(snapshot:, jev_client: nil)
    @snapshot = snapshot
    @pull_request = snapshot.pull_request
    @jev_client = jev_client || JevClient.new
  end

  def generate!
    unless @jev_client.configured?
      raise Error, "OPENROUTER_API_KEY is not set (or ~/.config/jev/config.json has no api key)"
    end

    files = fetch_changed_files
    raise Error, "PR has no changed files" if files.empty?

    @snapshot.pull_request_file_triages.delete_all

    records = files.map { |file| score_file(file) }
    ranked = records.reject(&:skipped).sort_by { |record| [ -record.priority, record.path ] }
    ranked.each_with_index { |record, index| record.update!(rank: index + 1) }

    @snapshot.store_file_triage!
    records
  rescue => e
    @snapshot.mark_file_triage_failed!(e.message)
    raise
  end

  private

  def fetch_changed_files
    stdout, stderr, status = Open3.capture3(
      "gh", "api",
      "repos/#{@pull_request.repo_full_name}/pulls/#{@pull_request.number}/files",
      "--paginate"
    )

    raise Error, stderr.presence || stdout.presence || "Failed to fetch PR files" unless status.success?

    parsed = JSON.parse(stdout)
    raise Error, "Unexpected PR files payload" unless parsed.is_a?(Array)

    parsed.map do |item|
      {
        path: item["filename"].to_s,
        status: item["status"].presence || "modified",
        additions: item["additions"].to_i,
        deletions: item["deletions"].to_i,
        patch: item["patch"].to_s
      }
    end.reject { |item| item[:path].blank? }
  rescue JSON::ParserError => e
    raise Error, "PR files JSON parse failed: #{e.message}"
  end

  def score_file(file)
    skip_reason = skip_reason_for(file[:path])
    if skip_reason
      return @snapshot.pull_request_file_triages.create!(
        path: file[:path],
        status: file[:status],
        additions: file[:additions],
        deletions: file[:deletions],
        role: "generated",
        core_score: 0.0,
        risk_score: 0.0,
        must_read_p: 0.0,
        priority: 0.0,
        confidence: 1.0,
        skipped: true,
        skip_reason: skip_reason,
        why: "Skipped: #{skip_reason}."
      )
    end

    response = @jev_client.decide(
      state: build_state(file),
      questions: FILE_QUESTIONS,
      session_id: "forge-file-triage-#{@snapshot.id}",
      user: "forge"
    )

    answers = response.fetch("answers")
    core = normalize_score(answers.fetch("core_to_change"))
    risk = normalize_score(answers.fetch("regression_risk"))
    role = normalize_role(answers.fetch("role"))
    must_read = normalize_noul(answers.fetch("must_read_by_hand"))
    confidence = [
      answers.dig("core_to_change", "confidence"),
      answers.dig("regression_risk", "confidence"),
      answers.dig("role", "confidence")
    ].compact.map(&:to_f).then { |values| values.any? ? values.sum / values.size : 0.0 }

    priority = (0.55 * core) + (0.35 * risk) + (0.10 * (must_read >= 0.5 ? 5.0 : 1.0))

    @snapshot.pull_request_file_triages.create!(
      path: file[:path],
      status: file[:status],
      additions: file[:additions],
      deletions: file[:deletions],
      role: role,
      core_score: core,
      risk_score: risk,
      must_read_p: must_read,
      priority: priority,
      confidence: confidence,
      skipped: false,
      why: PullRequestFileTriage::ROLE_WHY.fetch(role),
      raw_jev_response: JSON.generate(response)
    )
  end

  def build_state(file)
    {
      "pr" => {
        "title" => @pull_request.title,
        "body_excerpt" => @pull_request.description.to_s.truncate(BODY_EXCERPT_CHARS),
        "files_changed" => @pull_request.changed_files,
        "number" => @pull_request.number
      },
      "file" => {
        "path" => file[:path],
        "status" => file[:status],
        "additions" => file[:additions],
        "deletions" => file[:deletions],
        "patch_excerpt" => file[:patch].to_s.truncate(PATCH_EXCERPT_CHARS),
        "is_test" => test_path?(file[:path]),
        "extension" => File.extname(file[:path]).downcase.delete(".")
      },
      "heuristics" => heuristics_for(file[:path])
    }
  end

  def heuristics_for(path)
    lowered = path.downcase
    {
      "touches_auth" => lowered.match?(/auth|session|password|oauth|permission|policy/),
      "touches_money" => lowered.match?(/bill|payment|charge|invoice|stripe|pricing|money/),
      "touches_persistence" => lowered.match?(%r{(^|/)(models?|migrations?|db|schema|repository|repositories)/|\.sql\z}),
      "touches_api" => lowered.match?(%r{(^|/)(controllers?|api|graphql|serializers?|routes)/})
    }
  end

  def skip_reason_for(path)
    basename = File.basename(path)
    return "lockfile" if SKIP_BASENAMES.include?(basename)
    return "minified or map artifact" if SKIP_EXTENSIONS.any? { |ext| path.end_with?(ext) }
    return "vendored or build output" if SKIP_PATH_PARTS.any? { |part| path.include?(part) }

    nil
  end

  def test_path?(path)
    path.match?(%r{(^|/)(test|tests|spec|__tests__)(/|$)}i) || path.end_with?("_test.rb", "_spec.rb", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")
  end

  def normalize_score(answer)
    raise Error, "Expected score answer" unless answer.is_a?(Hash) && answer["type"] == "score"

    # Jev score is 0..(n-1); criteria has 5 levels => map to 1..5
    answer.fetch("score").to_f + 1.0
  end

  def normalize_role(answer)
    raise Error, "Expected choice answer" unless answer.is_a?(Hash) && answer["type"] == "choice"

    role = answer["choice"].to_s
    return role if PullRequestFileTriage::ROLES.include?(role)

    "chore"
  end

  def normalize_noul(answer)
    raise Error, "Expected noul answer" unless answer.is_a?(Hash) && answer["type"] == "noul"

    answer.fetch("noul").to_f
  end
end
