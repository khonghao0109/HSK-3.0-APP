import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import test from 'node:test';

import { CAPACITY_ROUTES, extractQuestionKeys, parseErrorCode } from './driver';
import {
  createMockS3Server,
  generateDeterministicPng,
  generateDeterministicWav,
  MOCK_TLS_CERT,
  type StoredMediaObject,
} from './media-fixtures';

type MockS3Response = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

/**
 * GET tới mock S3 với CA của chính nó: TLS verify vẫn bật, không tắt verify
 * bằng biến môi trường. `fetch` của Node không nhận `ca` theo từng request nên
 * dùng thẳng `node:https`.
 */
function getMockS3Object(url: string): Promise<MockS3Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { ca: MOCK_TLS_CERT }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

void test('parseErrorCode đọc error.code của envelope, null khi thiếu', () => {
  assert.equal(
    parseErrorCode({ error: { code: 'EXAM_ATTEMPT_EXPIRED' } }),
    'EXAM_ATTEMPT_EXPIRED',
  );
  assert.equal(parseErrorCode({ error: {} }), null);
  assert.equal(parseErrorCode({}), null);
  assert.equal(parseErrorCode(null), null);
  assert.equal(parseErrorCode('boom'), null);
});

void test('extractQuestionKeys giữ đúng thứ tự phần → nhóm → câu', () => {
  const view = {
    sections: [
      {
        groups: [
          { questions: [{ key: 'q1' }, { key: 'q2' }] },
          { questions: [{ key: 'q3' }] },
        ],
      },
      { groups: [{ questions: [{ key: 'q4' }] }] },
    ],
  };
  assert.deepEqual(extractQuestionKeys(view), ['q1', 'q2', 'q3', 'q4']);
});

void test('extractQuestionKeys trả rỗng khi payload không đúng shape', () => {
  assert.deepEqual(extractQuestionKeys(null), []);
  assert.deepEqual(extractQuestionKeys({}), []);
  assert.deepEqual(extractQuestionKeys({ sections: 'nope' }), []);
  assert.deepEqual(extractQuestionKeys({ sections: [{ groups: [{}] }] }), []);
});

void test('nhãn route không chứa id thật', () => {
  for (const route of Object.values(CAPACITY_ROUTES)) {
    assert.match(route, /^(GET|POST|PUT) \//u);
    assert.doesNotMatch(route, /\d{2,}/u);
  }
});

void test('generateDeterministicWav sinh WAV PCM 16-bit 8kHz hợp lệ', () => {
  const wav = generateDeterministicWav(1, 3);
  assert.ok(wav.length > 44);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.subarray(12, 16).toString('ascii'), 'fmt ');
  // 8000 samples/s * 3s * 2 bytes/sample + 44 header = 48044 bytes
  assert.equal(wav.length, 48_044);

  const wav2 = generateDeterministicWav(2, 3);
  assert.equal(wav2.length, 48_044);
  assert.notDeepEqual(wav, wav2); // Tần số khác nhau nên byte khác nhau
});

void test('generateDeterministicPng sinh PNG 320x180 RGB hợp lệ', () => {
  const png = generateDeterministicPng(1, 320, 180);
  assert.ok(png.length > 50);
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 320); // width
  assert.equal(png.readUInt32BE(20), 180); // height
});

void test('createMockS3Server phục vụ GetObject đúng header và metadata sha256', async () => {
  const store = new Map<string, StoredMediaObject>();
  const body = Buffer.from('capacity-test-audio-bytes');
  const checksum = createHash('sha256').update(body).digest('hex');
  store.set('media/test.wav', {
    key: 'media/test.wav',
    body,
    contentType: 'audio/wav',
    checksum,
  });

  const mock = await createMockS3Server(store, 'hsk-capacity');
  try {
    const res = await getMockS3Object(
      `${mock.url}/hsk-capacity/media/test.wav`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'audio/wav');
    assert.equal(res.headers['x-amz-meta-sha256'], checksum);
    assert.deepEqual(res.body, body);

    const notFound = await getMockS3Object(
      `${mock.url}/hsk-capacity/unknown.wav`,
    );
    assert.equal(notFound.status, 404);
  } finally {
    await mock.close();
  }
});
