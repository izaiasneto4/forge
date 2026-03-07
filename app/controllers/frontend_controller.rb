class FrontendController < ActionController::Base
  def index
    frontend_index = Rails.root.join("public/frontend/index.html")

    if frontend_index.exist?
      render file: frontend_index, layout: false, content_type: "text/html"
      return
    end

    if Rails.env.development?
      redirect_to "#{frontend_dev_url}#{request.fullpath}", allow_other_host: true
      return
    end

    render plain: "Frontend build not found", status: :service_unavailable
  end

  private

  def frontend_dev_url
    ENV.fetch("FRONTEND_DEV_URL", "http://localhost:5173")
  end
end
