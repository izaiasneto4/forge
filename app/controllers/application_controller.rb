class ApplicationController < ActionController::Base
  # Only allow modern browsers supporting current frontend/runtime features.
  allow_browser versions: :modern

  before_action :set_header_presenter

  private

  def set_header_presenter
    @header_presenter = HeaderPresenter.new
  end
end
