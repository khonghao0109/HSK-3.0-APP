import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  type OpenAPIObject,
  type OperationObject,
  SwaggerModule,
} from '@nestjs/swagger';

import {
  API_ENVELOPE_EXTENSION,
  type ApiEnvelopeExtension,
} from './api-envelope.decorator';
import {
  ApiErrorEnvelopeDto,
  ApiPageResponseMetaDto,
  ApiResponseMetaDto,
} from './api-envelope.dto';
import { OPENAPI_BEARER_AUTH } from './openapi.constants';

const ERROR_RESPONSE = 'ErrorEnvelope';
const REQUEST_ID_PARAMETER = 'RequestId';
const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/**
 * Builds the OpenAPI document of `app`, whose global prefix must already be
 * set. Property schemas come from the @nestjs/swagger CLI plugin, so the
 * result is complete only for code compiled by `nest build`.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('HSK System API')
    .setDescription(
      'Generated from the backend code. Envelope, errors and request id: docs/api/api.md §1.',
    )
    .setVersion('1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      OPENAPI_BEARER_AUTH,
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [
      ApiResponseMetaDto,
      ApiPageResponseMetaDto,
      ApiErrorEnvelopeDto,
    ],
  });
  return applyGlobalConventions(document);
}

/** Path of Swagger UI; the JSON document is served at `${OPENAPI_DOCS_PATH}-json`. */
export const OPENAPI_DOCS_PATH = 'api/docs';

/**
 * Serves Swagger UI only when `environment` is `development`; never under
 * `test` or `production`. Returns whether it did. Call it before middleware
 * that must not apply to the UI (the API's `default-src 'none'` CSP blocks
 * the UI's own scripts and styles).
 */
export function setupOpenApiDocs(
  app: INestApplication,
  environment: string,
): boolean {
  if (environment !== 'development') return false;
  SwaggerModule.setup(OPENAPI_DOCS_PATH, app, () => createOpenApiDocument(app));
  return true;
}

/**
 * Documents what global middleware, interceptor and filter do for every route:
 * - RequestIdMiddleware: an optional `X-Request-ID` request header.
 * - TransformInterceptor: every JSON success response becomes
 *   `{ success: true, data, meta }`; non-JSON responses (raw media bytes) are
 *   left as they are.
 * - GlobalExceptionFilter: the error envelope as the `default` response.
 */
function applyGlobalConventions(document: OpenAPIObject): OpenAPIObject {
  document.components = {
    ...document.components,
    parameters: {
      ...document.components?.parameters,
      [REQUEST_ID_PARAMETER]: {
        name: 'X-Request-ID',
        in: 'header',
        required: false,
        description:
          'UUID or 32 hex characters; any other value is replaced by a new UUID. Echoed in the X-Request-ID response header and meta.requestId.',
        schema: { type: 'string' },
      },
    },
    responses: {
      ...document.components?.responses,
      [ERROR_RESPONSE]: {
        description: 'Error envelope.',
        content: {
          'application/json': {
            schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) },
          },
        },
      },
    },
  };
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation) applyOperationConventions(operation);
    }
  }
  return document;
}

function applyOperationConventions(operation: OperationObject): void {
  // Handlers that read the header would otherwise document it as required.
  operation.parameters = [
    { $ref: `#/components/parameters/${REQUEST_ID_PARAMETER}` },
    ...(operation.parameters ?? []).filter(
      (parameter) =>
        '$ref' in parameter ||
        parameter.in !== 'header' ||
        parameter.name.toLowerCase() !== 'x-request-id',
    ),
  ];

  const extensions = operation as unknown as Record<string, unknown>;
  const envelope = extensions[API_ENVELOPE_EXTENSION] as
    | ApiEnvelopeExtension
    | undefined;
  delete extensions[API_ENVELOPE_EXTENSION];

  for (const [status, response] of Object.entries(operation.responses)) {
    if (!response || !/^2\d\d$/u.test(status) || '$ref' in response) continue;
    const mediaTypes = Object.keys(response.content ?? {});
    if (mediaTypes.some((type) => type !== 'application/json')) continue;
    operation.responses[status] = {
      description: response.description,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['success', 'data', 'meta'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              // `{}` is any JSON value: the handler has no documented model.
              data: envelope?.data ?? {},
              meta: {
                $ref: getSchemaPath(
                  envelope?.paginated
                    ? ApiPageResponseMetaDto
                    : ApiResponseMetaDto,
                ),
              },
            },
          },
        },
      },
    };
  }
  operation.responses.default = {
    $ref: `#/components/responses/${ERROR_RESPONSE}`,
  };
}
