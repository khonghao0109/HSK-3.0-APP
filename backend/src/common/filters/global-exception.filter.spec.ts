import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';

import { createSafeValidationException } from '../validation/safe-validation-exception.factory';
import { GlobalExceptionFilter } from './global-exception.filter';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';

function host(overrides: { headersSent?: boolean } = {}) {
  const json = jest.fn();
  const end = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const request = { headers: { 'x-request-id': REQUEST_ID } };
  const response = {
    status,
    end,
    setHeader,
    headersSent: overrides.headersSent ?? false,
  };
  const argumentsHost = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { argumentsHost, json, status, end, setHeader };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    logError.mockRestore();
  });

  const handle = (exception: unknown) => {
    const context = host();
    filter.catch(exception, context.argumentsHost);
    const [[body]] = context.json.mock.calls as [[Record<string, unknown>]];
    return { ...context, body };
  };

  it.each([
    [
      new UnauthorizedException('Invalid credentials'),
      401,
      { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
    ],
    [
      new ConflictException('Email already exists'),
      409,
      { code: 'CONFLICT', message: 'Email already exists' },
    ],
    [new NotFoundException(), 404, { code: 'NOT_FOUND', message: 'Not Found' }],
    [
      new ThrottlerException(),
      429,
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'ThrottlerException: Too Many Requests',
      },
    ],
    [
      new ServiceUnavailableException({
        code: 'MEDIA_INGESTION_DISABLED',
        message: 'Media ingestion is temporarily disabled.',
      }),
      503,
      {
        code: 'MEDIA_INGESTION_DISABLED',
        message: 'Media ingestion is temporarily disabled.',
      },
    ],
  ])('wraps %s in the error envelope', (exception, status, error) => {
    const { body, status: setStatus, setHeader } = handle(exception);

    expect(setStatus).toHaveBeenCalledWith(status);
    expect(body).toEqual({
      success: false,
      error,
      meta: { requestId: REQUEST_ID, timestamp: expect.any(String) },
    });
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', REQUEST_ID);
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps validation errors and other domain fields as details', () => {
    const validation = handle(
      createSafeValidationException([
        { property: 'email', constraints: { isEmail: 'x' } },
      ]),
    ).body;
    expect(validation.error).toEqual({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Request validation failed.',
      details: { errors: [{ path: '$.email', codes: ['isEmail'] }] },
    });

    const domain = handle(
      new UnprocessableEntityException({
        code: 'listening_media_not_ready',
        path: 'mediaId',
        message: 'Listening audio media must be ready and live.',
      }),
    ).body;
    expect(domain.error).toEqual({
      code: 'listening_media_not_ready',
      message: 'Listening audio media must be ready and live.',
      details: { path: 'mediaId' },
    });
  });

  it.each([
    [
      'a Prisma known request error',
      () =>
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`email`) value secret@example.com',
          { code: 'P2002', clientVersion: Prisma.prismaVersion.client },
        ),
    ],
    [
      'a driver error',
      () =>
        new Error(
          'relation "User" does not exist: SELECT password FROM "User"',
        ),
    ],
    ['a thrown string', () => 'SELECT * FROM secrets'],
  ])('hides %s behind a generic 500', (_, create) => {
    const { body, status } = handle(create());

    expect(status).toHaveBeenCalledWith(500);
    expect(body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
    });
    const exposed = JSON.stringify([body, logError.mock.calls]);
    for (const secret of [
      'secret@example.com',
      'SELECT',
      'P2002',
      'password',
    ]) {
      expect(exposed).not.toContain(secret);
    }
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining(`requestId=${REQUEST_ID}`),
    );
  });

  it.each([
    'Unexpected token \'a\', "{"password":a}" is not valid JSON',
    'Unterminated string in JSON at position 11 (line 1 column 12)',
    "Failed to decode param '%FFsecret'",
    'URI malformed',
  ])('does not reflect the request in parser error %j', (message) => {
    const { body } = handle(new BadRequestException(message));

    expect(body.error).toEqual({
      code: 'MALFORMED_REQUEST',
      message: 'Request body or path could not be parsed.',
    });
  });

  it('keeps authored 400 messages', () => {
    expect(
      handle(new BadRequestException('Password is too weak.')).body.error,
    ).toEqual({ code: 'BAD_REQUEST', message: 'Password is too weak.' });
  });

  it('drops the query string from unknown-route 404s', () => {
    const { body } = handle(
      new NotFoundException('Cannot GET /api/v1/nope?signature=secret'),
    );

    expect(body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/v1/nope',
    });
  });

  it('keeps only the status of raw body-parser errors', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
    });

    const { body, status } = handle(tooLarge);

    expect(status).toHaveBeenCalledWith(413);
    expect(body.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Payload Too Large',
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('only closes the connection when a response was already streaming', () => {
    const context = host({ headersSent: true });

    filter.catch(new Error('stream broke'), context.argumentsHost);

    expect(context.end).toHaveBeenCalledTimes(1);
    expect(context.status).not.toHaveBeenCalled();
  });
});
