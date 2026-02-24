require "shellwords"

class RepoScannerService
  class Error < StandardError; end

  def initialize(base_folder)
    @base_folder = base_folder
  end

  def scan
    return [] unless @base_folder.present? && Dir.exist?(@base_folder)

    repos = []
    Dir.entries(@base_folder).each do |entry|
      next if entry.start_with?(".")

      full_path = File.join(@base_folder, entry)
      next unless File.directory?(full_path)
      next unless git_repo?(full_path)

      repos << {
        name: entry,
        path: full_path,
        remote_url: remote_url(full_path),
        branch: current_branch(full_path)
      }
    end

    repos.sort_by { |r| r[:name].downcase }
  end

  private

  def git_repo?(path)
    git_path = File.join(path, ".git")
    return true if File.directory?(git_path)

    return false unless File.file?(git_path)

    File.read(git_path, 256).to_s.start_with?("gitdir:")
  rescue
    false
  end

  def remote_url(path)
    `git -C #{Shellwords.escape(path)} remote get-url origin 2>/dev/null`.strip
  rescue
    nil
  end

  def current_branch(path)
    `git -C #{Shellwords.escape(path)} branch --show-current 2>/dev/null`.strip
  rescue
    nil
  end
end
