import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPACITY_ROUTES, extractQuestionKeys, parseErrorCode } from './driver';

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
