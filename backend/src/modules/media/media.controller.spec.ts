import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { MediaAccessService } from './media-access.service';
import { MediaController } from './media.controller';

describe('MediaController signed content request target', () => {
  const query = { expires: 1_800_000_000, signature: 'a'.repeat(64) };

  it('forwards the exact raw canonical path and method without signed query data', async () => {
    const body = Buffer.from('media');
    const readSignedObject = jest.fn().mockResolvedValue({
      body,
      contentType: 'image/png',
      checksum: 'b'.repeat(64),
      size: body.length,
    });
    const controller = new MediaController({
      readSignedObject,
    } as unknown as MediaAccessService);
    const setHeader = jest.fn();
    const end = jest.fn();
    const response = { setHeader, end } as unknown as Response;

    await controller.getContent(
      {
        method: 'GET',
        originalUrl:
          `/api/v1/media/41/content?expires=${query.expires}` +
          `&signature=${query.signature}`,
      } as Request,
      41,
      query,
      response,
    );

    expect(readSignedObject).toHaveBeenCalledWith(
      41,
      query.expires,
      query.signature,
      { method: 'GET', path: '/api/v1/media/41/content' },
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(end).toHaveBeenCalledWith(body);
  });

  it.each([
    ['HEAD', '/api/v1/media/41/content'],
    ['GET', '/api/v1/media/41/content/'],
    ['GET', '/API/v1/media/41/content'],
    ['GET', '/api/v1/media//41/content'],
    ['GET', '/api/v1/media/41/content;download'],
    ['GET', '/api/v1/media%2F41/content'],
  ])(
    'does not canonicalize %s %s before verification',
    async (method, path) => {
      const readSignedObject = jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Invalid grant.'));
      const controller = new MediaController({
        readSignedObject,
      } as unknown as MediaAccessService);

      await expect(
        controller.getContent(
          {
            method,
            originalUrl: `${path}?expires=${query.expires}&signature=${query.signature}`,
          } as Request,
          41,
          query,
          {} as Response,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(readSignedObject).toHaveBeenCalledWith(
        41,
        query.expires,
        query.signature,
        { method, path },
      );
    },
  );
});
