class Api::V1::BaseController < ActionController::API
  rescue_from ActiveRecord::RecordNotFound do
    render_error("not_found", "Resource not found", :not_found)
  end

  rescue_from ActionController::ParameterMissing do |e|
    render_error("invalid_input", e.message, :unprocessable_entity)
  end

  private

  def render_ok(payload = {}, status = :ok)
    render json: payload.merge(ok: true), status: status
  end

  def render_error(code, message, status = :unprocessable_entity, details: nil)
    error = { code: code, message: message }
    error[:details] = details if details.present?
    render json: { ok: false, error: error }, status: status
  end

  def parse_boolean(value)
    return true if value == true || value.to_s == "true" || value.to_s == "1"
    return false if value == false || value.to_s == "false" || value.to_s == "0" || value.nil?

    raise ArgumentError, "Invalid boolean value: #{value.inspect}"
  end

  def parse_integer(value, default:, min:, max:, name:)
    return default if value.blank?

    parsed = Integer(value)
    raise ArgumentError, "#{name} must be between #{min} and #{max}" if parsed < min || parsed > max

    parsed
  rescue ArgumentError
    raise ArgumentError, "#{name} must be between #{min} and #{max}"
  end
end
