import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  getSchemaPath,
  type ReferenceObject,
  type SchemaObject,
} from '@nestjs/swagger';

export const API_ENVELOPE_EXTENSION = 'x-api-envelope';

export type ApiEnvelopeExtension = {
  data: SchemaObject | ReferenceObject;
  paginated: boolean;
};

/**
 * Documents `data` of the success envelope for one handler; `[Model]` is a
 * list and `paginated` adds `meta.pagination`. The envelope itself and the
 * status code are added by `createOpenApiDocument`, which leaves `data`
 * untyped for handlers without this decorator.
 */
export function ApiEnvelope(model: Type<unknown>): MethodDecorator;
export function ApiEnvelope(
  model: [Type<unknown>],
  options?: { paginated?: boolean },
): MethodDecorator;
export function ApiEnvelope(
  model: Type<unknown> | [Type<unknown>],
  options: { paginated?: boolean } = {},
): MethodDecorator {
  const type = Array.isArray(model) ? model[0] : model;
  const reference = { $ref: getSchemaPath(type) };
  const extension: ApiEnvelopeExtension = {
    data: Array.isArray(model)
      ? { type: 'array', items: reference }
      : reference,
    paginated: options.paginated === true,
  };
  return applyDecorators(
    ApiExtraModels(type),
    ApiExtension(API_ENVELOPE_EXTENSION, extension),
  );
}
