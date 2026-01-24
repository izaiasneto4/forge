namespace :pull_requests do
  desc "Fix orphaned review states (PRs marked as reviewed/in_review/failed without review tasks)"
  task fix_orphaned_states: :environment do
    puts "Checking for orphaned review states..."

    fixed_count = PullRequest.fix_orphaned_review_states

    if fixed_count > 0
      puts "✓ Fixed #{fixed_count} orphaned pull request(s)"
    else
      puts "✓ No orphaned states found - all pull requests are consistent"
    end
  end

  desc "Validate review state consistency for all pull requests"
  task validate_consistency: :environment do
    puts "Validating review state consistency..."

    inconsistent_prs = []

    PullRequest.find_each do |pr|
      unless pr.valid?
        if pr.errors[:review_status].any?
          inconsistent_prs << {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            status: pr.review_status,
            errors: pr.errors[:review_status]
          }
        end
      end
    end

    if inconsistent_prs.any?
      puts "⚠ Found #{inconsistent_prs.size} inconsistent pull request(s):"
      inconsistent_prs.each do |pr|
        puts "  - PR ##{pr[:number]} (#{pr[:title]}): #{pr[:status]} - #{pr[:errors].join(', ')}"
      end
      puts "\nRun 'rake pull_requests:fix_orphaned_states' to fix these issues"
    else
      puts "✓ All pull requests have consistent review states"
    end
  end
end
