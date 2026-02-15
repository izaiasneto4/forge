require "open3"

class CodeReviewService
  class Error < StandardError; end

  CLIENTS = {
    "claude" => { command: "claude", args: [ "-p" ], skill: "/code-review" },
    "codex" => { command: "codex", args: [ "exec" ], skill: nil },
    "opencode" => { command: "opencode", args: [ "run" ], skill: nil }
  }.freeze

  attr_reader :cli_client

  def self.for(cli_client:, worktree_path:, pull_request:, review_type: "review")
    config = CLIENTS[cli_client] || CLIENTS["claude"]
    new(
      cli_client: cli_client,
      command: config[:command],
      args: config[:args],
      skill: config[:skill],
      worktree_path: worktree_path,
      pull_request: pull_request,
      review_type: review_type
    )
  end

  def initialize(cli_client:, command:, args:, skill:, worktree_path:, pull_request:, review_type: "review")
    @cli_client = cli_client
    @command = command
    @args = args
    @skill = skill
    @worktree_path = worktree_path
    @pull_request = pull_request
    @review_type = review_type
  end

  def detect_model
    ModelDetector.detect(@cli_client)
  end

  def run_review
    validate_worktree!
    clear_codex_last_message!

    cmd_args = cmd_args_for_review
    stdin, stdout, stderr, wait_thr = Open3.popen3(*cmd_args, chdir: @worktree_path)
    stdin.close

    raw_output = stdout.read
    output = normalize_output(raw_output)
    error = stderr.read
    status = wait_thr.value

    unless status.success?
      Rails.logger.error("#{@command} review error: #{error}")
      raise Error, "#{@command} review failed: #{error}" if output.blank?
    end

    output
  end

  def run_review_streaming(&block)
    validate_worktree!
    clear_codex_last_message!

    cmd_args = cmd_args_for_review
    raw_output = []
    Open3.popen2e(*cmd_args, chdir: @worktree_path) do |stdin, stdout_err, wait_thr|
      stdin.close

      stdout_err.each_line do |line|
        raw_output << line
        yield line if block_given?
      end

      wait_thr.value
    end

    normalize_output(raw_output.join)
  end

  private

  def validate_worktree!
    raise Error, "Worktree path not found: #{@worktree_path}" unless Dir.exist?(@worktree_path)
  end

  def review_prompt
    @review_type == "swarm" ? swarm_review_prompt : standard_review_prompt
  end

  def cmd_args_for_review
    base_args = [ @command ] + @args
    return base_args + [ review_prompt ] unless codex_client?

    base_args + [ "--output-last-message", codex_last_message_path, review_prompt ]
  end

  def codex_client?
    @cli_client == "codex"
  end

  def codex_last_message_path
    File.join(@worktree_path, ".forge_codex_last_message.md")
  end

  def clear_codex_last_message!
    return unless codex_client?
    File.delete(codex_last_message_path) if File.exist?(codex_last_message_path)
  end

  def normalize_output(raw_output)
    return raw_output unless codex_client?

    file_output = if File.exist?(codex_last_message_path)
      File.read(codex_last_message_path).to_s
    else
      ""
    end

    file_output.present? ? file_output : raw_output
  end

  def standard_review_prompt
    skill_instruction = @skill ? "Run #{@skill} to analyze the changes." : "Analyze the code changes."

    <<~PROMPT
      Review PR ##{@pull_request.number}: #{@pull_request.title}

      #{@pull_request.description}

      IMPORTANT SCOPE CONSTRAINT: You must ONLY review code that was actually changed in this PR.
      - Use `gh pr diff` or `git diff` to identify exactly which files and lines were modified
      - Do NOT flag issues in pre-existing code that wasn't touched by this PR
      - Do NOT review or comment on files that weren't modified in this PR
      - Only flag issues on lines that were added or modified, not surrounding unchanged code

      Focus your review on:
      - Code quality and best practices (only in changed code)
      - Potential bugs or issues introduced by this PR
      - Security concerns in the new/modified code
      - Performance implications of the changes

      #{skill_instruction}

      After completing the review, you MUST output your findings as a JSON array wrapped in ```json code block.
      Each item in the array should have this exact structure:
      {
        "severity": "error" | "warning" | "info",
        "file": "path/to/file.ext",
        "lines": "10-20" or "10" or null,
        "comment": "Description of the issue in markdown",
        "suggested_fix": "Code suggestion if applicable, or null"
      }

      Example output format:
      ```json
      [
        {
          "severity": "warning",
          "file": "src/components/ItemList.tsx",
          "lines": "45-50",
          "comment": "Sequential awaits inside loop. For many items, this is slow.\\n\\n**Suggestion:** Use `Promise.all()` or batch operations.",
          "suggested_fix": "await Promise.all(items.map((item) => processItem(item)));"
        }
      ]
      ```

      IMPORTANT: Replace the example values above with actual data from the PR you are reviewing.

      IMPORTANT: Always wrap the JSON in ```json code fences. If no issues found, return an empty array: ```json\\n[]\\n```
    PROMPT
  end

  def swarm_review_prompt
    <<~PROMPT
      # Deep Code Review - Multi-Agent Analysis

      You are orchestrating a comprehensive code review using 7 specialized reviewer agents. Your job is to:
      1. Invoke each specialized reviewer
      2. Collect all findings
      3. Consolidate by consensus and priority
      4. Return structured findings for automated UI mapping

      ## Target for Review

      PR ##{@pull_request.number}: #{@pull_request.title}

      #{@pull_request.description}

      Review the changes in this PR. Use `gh pr diff` or `git diff` to identify exactly which files and lines were modified.

      ## Step 1: Invoke Specialized Reviewers

      Call each of these 7 specialized reviewers to analyze the code using the Task tool with parallel agents:

      1. **Security Reviewer** - Analyze for security vulnerabilities (OWASP, auth, secrets, etc.)
      2. **Data Consistency Reviewer** - Detect data mismatches, inconsistencies across data sources, and calculation discrepancies
      3. **Code Smell Reviewer** - Detect code smells and clean code violations
      4. **Design Pattern Reviewer** - Review architecture and design patterns (SOLID, anti-patterns)
      5. **Performance Reviewer** - Identify performance issues and optimization opportunities
      6. **Maintainability Reviewer** - Assess maintainability, readability, and technical debt
      7. **Regression Reviewer** - Detect behavioral regressions, ensuring code changes don't break existing functionality

      For each reviewer, ask them to analyze the target code and return their findings in the specified format.

      ## Step 2: Consolidate Findings

      After receiving all reviews, consolidate the findings:

      ### Consensus Rules
      - **CRITICAL**: Issues flagged as CRITICAL by ANY reviewer
      - **HIGH**: Issues flagged as HIGH by 2+ reviewers OR HIGH by 1 reviewer + related findings
      - **MEDIUM**: Issues flagged by 2+ reviewers at any level
      - **LOW**: Single reviewer findings not meeting above criteria

      ### Deduplication
      - Merge similar issues across reviewers
      - Note when multiple reviewers identified the same issue (strengthens priority)
      - Combine recommendations from different perspectives

      ## Step 3: Return Structured Output

      After consolidation, you MUST output your findings as a JSON array wrapped in ```json code block.
      Each item in the array should have this exact structure:
      {
        "severity": "error" | "warning" | "info",
        "file": "path/to/file.ext",
        "lines": "10-20" or "10" or null,
        "comment": "Description of the issue in markdown",
        "suggested_fix": "Code suggestion if applicable, or null"
      }

      If no issues are found, return:
      ```json
      []
      ```

      ## Important Notes

      - Be thorough but avoid false positives
      - Prioritize real issues over theoretical concerns
      - Include enough context for another agent to implement fixes
      - The report should be actionable, not just informational
    PROMPT
  end
end
