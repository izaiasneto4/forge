namespace :forge do
  desc "Backfill Waiting on Author state from GitHub review history (dry-run by default). Use APPLY=1 to persist."
  task backfill_waiting_on_author: :environment do
    apply = ENV["APPLY"] == "1"
    limit = ENV["LIMIT"]&.to_i
    limit = nil if limit&.zero?

    service = ReviewLifecycleBackfillService.new
    service.run(apply: apply, limit: limit)
  end
end
