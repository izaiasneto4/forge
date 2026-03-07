class Api::V1::BootstrapController < Api::V1::BaseController
  def show
    render_ok(Api::V1::UiPayloads::Bootstrap.new.as_json)
  end
end
