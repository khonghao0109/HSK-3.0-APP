import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { setupOpenApiDocs } from './openapi-document';

@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

async function appFor(environment: string) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication();
  const enabled = setupOpenApiDocs(app, environment);
  await app.init();
  return { app, enabled };
}

describe('setupOpenApiDocs', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each(['production', 'test', 'staging', ''])(
    'serves nothing when NODE_ENV is %j',
    async (environment) => {
      const setup = await appFor(environment);
      app = setup.app;

      expect(setup.enabled).toBe(false);
      await request(app.getHttpServer()).get('/api/docs').expect(404);
      await request(app.getHttpServer()).get('/api/docs-json').expect(404);
    },
  );

  it('serves Swagger UI and the document in development', async () => {
    const setup = await appFor('development');
    app = setup.app;

    expect(setup.enabled).toBe(true);
    const ui = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(ui.headers['content-type']).toContain('text/html');
    const json = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(json.body).toMatchObject({
      openapi: '3.0.0',
      paths: { '/probe': { get: expect.any(Object) as unknown } },
    });
  });
});
