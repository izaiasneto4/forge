require "pathname"

class PathValidator
  MAX_PATH_LENGTH = 4096
  class ValidationError < StandardError; end

  def self.validate(path, allowed_base: nil)
    new.validate(path, allowed_base: allowed_base)
  end

  # Validate a path that may not exist yet (for creating new files/directories)
  def self.validate_new_path(path, allowed_base: nil)
    new.validate_new_path(path, allowed_base: allowed_base)
  end

  def validate(path, allowed_base: nil)
    return nil unless valid_input?(path)
    return nil unless path_length_valid?(path)
    return nil if contains_traversal?(path)

    resolved_path = resolve_path(path)
    return nil unless resolved_path

    return nil unless within_allowed_base?(resolved_path, allowed_base) if allowed_base

    resolved_path.to_s
  rescue Errno::ENOENT, Errno::EACCES, Errno::ELOOP, ArgumentError
    nil
  end

  # Validate a path that doesn't exist yet by checking its parent and components
  def validate_new_path(path, allowed_base: nil)
    return nil unless valid_input?(path)
    return nil unless path_length_valid?(path)
    return nil if contains_traversal?(path)

    pathname = Pathname.new(path)
    parent = find_existing_ancestor(pathname)
    return nil unless parent

    if allowed_base
      resolved_base = Pathname.new(allowed_base).realpath
      return nil unless parent.to_s.start_with?(resolved_base.to_s)
    end

    # Return the clean expanded path (without requiring it to exist)
    pathname.cleanpath.to_s
  rescue Errno::ENOENT, Errno::EACCES, Errno::ELOOP
    nil
  end

  private

  def valid_input?(path)
    path.is_a?(String) && !path.empty?
  end

  def resolve_path(path)
    Pathname.new(path).realpath
  end

  def contains_traversal?(path)
    path.include?("..") || path.include?("\0")
  end

  def find_existing_ancestor(pathname)
    current = pathname.expand_path
    until current.exist?
      current = current.parent
      return nil if current.to_s == "/" || current.to_s == "."
    end
    current.realpath
  end

  def path_length_valid?(path)
    path.to_s.length <= MAX_PATH_LENGTH
  end

  def within_allowed_base?(resolved_path, allowed_base)
    resolved_base = Pathname.new(allowed_base).realpath
    resolved_path.descend.any? { |p| p == resolved_base } ||
      resolved_path.to_s.start_with?(resolved_base.to_s + File::SEPARATOR) ||
      resolved_path == resolved_base
  rescue Errno::ENOENT, Errno::EACCES
    false
  end
end
