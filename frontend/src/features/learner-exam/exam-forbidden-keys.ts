/**
 * R11 (TL-137): các key tuyệt đối không được xuất hiện trong payload BFF,
 * HTML hay RSC gửi tới learner. Dùng chung cho unit test route handler và
 * e2e để hai nơi không lệch nhau (vòng 2c-b, R1).
 */
export const FORBIDDEN_KEYS = [
  'correctAnswer',
  'explanation',
  'acceptedTexts',
  'caseSensitive',
  'tokenIds',
  'optionId',
  'isCorrect',
  'contentHash',
  'questionId',
  'questionVersion',
] as const;
