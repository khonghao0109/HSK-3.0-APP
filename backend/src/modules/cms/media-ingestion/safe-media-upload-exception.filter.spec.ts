import {
  ArgumentsHost,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';

import { SafeMediaUploadExceptionFilter } from './safe-media-upload-exception.filter';

describe('SafeMediaUploadExceptionFilter', () => {
  const filter = new SafeMediaUploadExceptionFilter();

  it('does not reflect an attacker-controlled multipart field name', () => {
    const { host, json, status } = createHost();
    filter.catch(
      new BadRequestException('Unexpected field - secret@example.com'),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'MULTIPART_INVALID',
      message: 'Media upload request is malformed.',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret@example.com');
  });

  it('classifies parser size failures without returning parser internals', () => {
    const { host, json, status } = createHost();
    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      code: 'UPLOAD_TOO_LARGE',
      message: 'Media upload exceeds the allowed size.',
    });
  });

  it('preserves only the explicitly safe domain filename message', () => {
    const { host, json } = createHost();
    filter.catch(
      new BadRequestException('Upload filename is not allowed.'),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Upload filename is not allowed.',
      error: 'Bad Request',
    });
  });
});

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}
