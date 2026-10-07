// A list of string constants that keeps each value's literal type, so
// `(typeof VALUES)[number]` is their union instead of `string`.
export function literals<const Values extends readonly string[]>(...values: Values): Values {
  return values
}
