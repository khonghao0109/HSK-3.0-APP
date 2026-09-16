// The Swagger plugin renders `unknown` and type aliases as `{ type: 'object' }`
// without properties, which type generators read as an empty object. JSON
// payload fields use these schemas explicitly instead.

export const JSON_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const;

/** What BoundedJsonPayload accepts: a JSON object or array. */
export const JSON_OBJECT_OR_ARRAY_SCHEMA = {
  oneOf: [JSON_OBJECT_SCHEMA, { type: 'array', items: {} }],
};
