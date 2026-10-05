import { LEARNER_AUTH_ERROR_MESSAGES } from '@/features/learner-auth/learner-auth-messages';

export const ONBOARDING_ERROR_MESSAGES = {
  contentUnavailable:
    'Đã lưu mục tiêu nhưng cấp độ này chưa có bài học. Hãy chọn cấp độ khác.',
  levelUnavailable: 'Cấp độ này chưa mở. Hãy chọn cấp độ khác.',
  conflict: 'Dữ liệu vừa thay đổi. Vui lòng thử lại.',
  changeLevelLinkText: 'Chọn cấp độ khác',
  goalContentUnavailableNotice:
    'Cấp độ bạn chọn hiện chưa có bài học. Hãy chọn cấp độ khác.',
  levelUnavailableAlert: (band: number) =>
    `HSK ${band} chưa mở. Hãy chọn cấp độ khác.`,
  rateLimited: LEARNER_AUTH_ERROR_MESSAGES.rateLimited,
  generic: LEARNER_AUTH_ERROR_MESSAGES.generic,
  network: LEARNER_AUTH_ERROR_MESSAGES.network,
};
