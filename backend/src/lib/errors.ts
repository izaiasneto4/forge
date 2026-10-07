// ActiveRecord::RecordNotFound; rendered as 404 not_found by the error envelope.
export class RecordNotFoundError extends Error {
  constructor(readonly model: string, readonly id: unknown) {
    super(`Couldn't find ${model} with 'id'=${String(id)}`)
  }
}

// ActiveRecord::RecordInvalid; `fullMessages` mirrors `record.errors.full_messages`.
export class RecordInvalidError extends Error {
  constructor(readonly fullMessages: string[]) {
    super(`Validation failed: ${fullMessages.join(', ')}`)
  }
}

// ActionController::ParameterMissing; rendered as 422 invalid_input.
export class ParameterMissingError extends Error {
  constructor(readonly param: string) {
    super(`param is missing or the value is empty or invalid: ${param}`)
  }
}
