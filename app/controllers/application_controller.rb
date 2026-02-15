class ApplicationController < ActionController::Base
  # Only allow modern browsers supporting webp images, web push, badges, import maps, CSS nesting, and CSS :has.
  allow_browser versions: :modern

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes

  before_action :authenticate_user!
  before_action :set_header_presenter

  protected

  def require_admin
    unless current_user&.admin?
      redirect_to root_path, alert: "You don't have permission to perform this action."
    end
  end

  private

  def set_header_presenter
    @header_presenter = HeaderPresenter.new
  end
end
