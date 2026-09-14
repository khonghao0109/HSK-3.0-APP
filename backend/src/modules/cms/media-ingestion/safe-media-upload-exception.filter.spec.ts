import {
  ArgumentsHost,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';

import { SafeMediaUploadExceptionFilter } from './safe-media-upload-exception.filter';

const REQUEST_ID = '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f';

describe('SafeMediaUploadExceptionFilter', () => {
  const filter = new SafeMediaUploadExceptionFilter();

  it('does not reflect an attacker-controlled multipart field name', () => {
    const { host, json, status } = createHost();
    filter.catch(
      new BadRequestException('Unexpected field - secret@example.com'),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      envelope({
        code: 'MULTIPART_INVALID',
        message: 'Media upload request is malformed.',
      }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret@example.com');
  });

  it('classifies parser size failures without returning parser internals', () => {
    const { host, json, status } = createHost();
    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      envelope({
        code: 'UPLOAD_TOO_LARGE',
        message: 'Media upload exceeds the allowed size.',
      }),
    );
  });

  it('preserves only the explicitly safe domain filename message', () => {
    const { host, json } = createHost();
    filter.catch(
      new BadRequestException('Upload filename is not allowed.'),
      host,
    );
    expect(json).toHaveBeenCalledWith(
      envelope({
        code: 'BAD_REQUEST',
        message: 'Upload filename is not allowed.',
      }),
    );
  });
});

function envelope(error: { code: string; message: string }) {
  return {
    success: false,
    error,
    meta: { requestId: REQUEST_ID, timestamp: expect.any(String) as string },
  };
}

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const request = { headers: { 'x-request-id': REQUEST_ID } };
  const response = { status, setHeader: jest.fn(), headersSent: false };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}
