import '../../../scripts/openapi/document-environment';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Controller,
  Get,
  Headers,
  type INestApplication,
  Post,
  type Type,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ApiHeader,
  ApiOkResponse,
  type OpenAPIObject,
  type OperationObject,
  type ResponseObject,
} from '@nestjs/swagger';

import { AppModule } from '../../app.module';
import { API_GLOBAL_PREFIX } from '../../config/app.config';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiEnvelope } from './api-envelope.decorator';
import { createOpenApiDocument } from './openapi-document';

class ProbeItemDto {
  id!: number;
}

@Controller('probe')
class ProbeController {
  @Get('untyped')
  untyped() {
    return { ok: true };
  }

  @Get('item')
  @ApiEnvelope(ProbeItemDto)
  item() {
    return { id: 1 };
  }

  @Get('items')
  @ApiEnvelope([ProbeItemDto], { paginated: true })
  items() {
    return [];
  }

  @Post('items')
  @ApiEnvelope(ProbeItemDto)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(@Headers('x-request-id') requestId?: string) {
    return { id: 1, requestId };
  }

  @Get('bytes')
  @ApiOkResponse({
    content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
  })
  bytes() {
    return undefined;
  }
}

const ERROR_DEFAULT = { $ref: '#/components/responses/ErrorEnvelope' };
const REQUEST_ID = { $ref: '#/components/parameters/RequestId' };

function envelope(data: object, meta: string) {
  return {
    type: 'object',
    required: ['success', 'data', 'meta'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data,
      meta: { $ref: `#/components/schemas/${meta}` },
    },
  };
}

function operations(document: OpenAPIObject) {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => method !== 'parameters')
      .map(([method, operation]) => ({
        path,
        method,
        operation: operation as OperationObject,
      })),
  );
}

describe('createOpenApiDocument', () => {
  describe('response envelopes', () => {
    let app: INestApplication;
    let document: OpenAPIObject;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
      }).compile();
      app = moduleRef.createNestApplication();
      document = createOpenApiDocument(app);
    });

    afterAll(async () => {
      await app.close();
    });

    function operation(path: string, method: 'get' | 'post') {
      return document.paths[path]?.[method];
    }

    function responses(path: string, method: 'get' | 'post') {
      return operation(path, method)?.responses as
        | Record<string, ResponseObject>
        | undefined;
    }

    it('wraps a handler without a documented model with untyped data', () => {
      expect(responses('/probe/untyped', 'get')).toEqual({
        200: {
          description: '',
          content: {
            'application/json': {
              schema: envelope({}, 'ApiResponseMetaDto'),
            },
          },
        },
        default: ERROR_DEFAULT,
      });
      expect(operation('/probe/untyped', 'get')?.parameters).toEqual([
        REQUEST_ID,
      ]);
    });

    it('documents X-Request-ID as optional even where a handler reads it', () => {
      expect(operation('/probe/items', 'post')?.parameters).toEqual([
        REQUEST_ID,
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string' },
        },
      ]);
      expect(document.components?.parameters?.RequestId).toMatchObject({
        name: 'X-Request-ID',
        in: 'header',
        required: false,
      });
    });

    it('documents data from @ApiEnvelope and keeps the handler status', () => {
      const item = envelope(
        { $ref: '#/components/schemas/ProbeItemDto' },
        'ApiResponseMetaDto',
      );
      expect(
        responses('/probe/item', 'get')?.[200]?.content?.['application/json'],
      ).toEqual({ schema: item });
      expect(
        responses('/probe/items', 'post')?.[201]?.content?.['application/json'],
      ).toEqual({ schema: item });
      expect(
        responses('/probe/items', 'get')?.[200]?.content?.['application/json'],
      ).toEqual({
        schema: envelope(
          {
            type: 'array',
            items: { $ref: '#/components/schemas/ProbeItemDto' },
          },
          'ApiPageResponseMetaDto',
        ),
      });
      expect(document.components?.schemas).toHaveProperty('ProbeItemDto');
      expect(JSON.stringify(document)).not.toContain('x-api-envelope');
    });

    it('leaves non-JSON responses such as raw bytes unwrapped', () => {
      expect(responses('/probe/bytes', 'get')).toEqual({
        200: {
          description: '',
          content: {
            '*/*': { schema: { type: 'string', format: 'binary' } },
          },
        },
        default: ERROR_DEFAULT,
      });
    });

    it('defines the error envelope and the bearer scheme', () => {
      expect(document.components?.responses?.ErrorEnvelope).toEqual({
        description: 'Error envelope.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelopeDto' },
          },
        },
      });
      expect(document.components?.schemas?.ApiErrorEnvelopeDto).toMatchObject({
        properties: { success: { type: 'boolean', enum: [false] } },
      });
      expect(document.components?.securitySchemes).toEqual({
        JWT: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      });
    });
  });

  // Unit tests run without the Swagger CLI plugin, so property schemas are
  // missing here; `npm run openapi:check` compares those in CI.
  describe('AppModule', () => {
    let app: INestApplication;
    let document: OpenAPIObject;
    const controllers = new Map<string, Type<unknown>>();

    beforeAll(async () => {
      app = await NestFactory.create(AppModule, {
        preview: true,
        logger: false,
        abortOnError: false,
      });
      app.setGlobalPrefix(API_GLOBAL_PREFIX);
      document = createOpenApiDocument(app);
      for (const module of app.get(ModulesContainer).values()) {
        for (const wrapper of module.controllers.values()) {
          controllers.set(wrapper.name, wrapper.metatype as Type<unknown>);
        }
      }
    });

    afterAll(async () => {
      await app.close();
    });

    it('gives every operation the error envelope and a JSON success envelope', () => {
      const all = operations(document);
      expect(all.length).toBeGreaterThan(0);
      for (const { operation } of all) {
        expect(operation.responses.default).toEqual(ERROR_DEFAULT);
        const success = Object.entries(operation.responses).filter(([status]) =>
          /^2\d\d$/u.test(status),
        );
        expect(success).toHaveLength(1);
        const content = (success[0]?.[1] as { content?: object }).content;
        if (operation.operationId === 'MediaController_getContent') {
          expect(content).toEqual({
            '*/*': { schema: { type: 'string', format: 'binary' } },
          });
        } else {
          expect(content).toEqual({
            'application/json': {
              schema: expect.objectContaining({
                required: ['success', 'data', 'meta'],
              }) as unknown,
            },
          });
        }
      }
    });

    it('marks exactly the JwtAuthGuard routes with bearer security', () => {
      for (const { path, method, operation } of operations(document)) {
        const [controllerName, handlerName] = (
          operation.operationId ?? ''
        ).split('_');
        const controller = controllers.get(controllerName ?? '');
        const handler = (
          controller?.prototype as Record<string, object> | undefined
        )?.[handlerName ?? ''];
        expect({ path, method, found: handler !== undefined }).toEqual({
          path,
          method,
          found: true,
        });
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, controller as object) ??
            []) as unknown[]),
          ...((Reflect.getMetadata(GUARDS_METADATA, handler as object) ??
            []) as unknown[]),
        ];
        expect({
          path,
          method,
          secured: operation.security !== undefined,
        }).toEqual({
          path,
          method,
          secured: guards.includes(JwtAuthGuard),
        });
        if (operation.security) {
          expect(operation.security).toEqual([{ JWT: [] }]);
        }
      }
    });

    it('lists the same operations as the committed openapi.json', () => {
      const committed = JSON.parse(
        readFileSync(resolve(__dirname, '../../../openapi.json'), 'utf8'),
      ) as OpenAPIObject;
      const summary = (source: OpenAPIObject) =>
        operations(source)
          .map(
            ({ path, method, operation }) =>
              `${method.toUpperCase()} ${path} ${operation.operationId} ${Object.keys(operation.responses).join(',')} ${operation.security ? 'JWT' : 'public'}`,
          )
          .sort();

      // Regenerate with `npm run openapi:generate` when routes change.
      expect(summary(committed)).toEqual(summary(document));
    });
  });
});
