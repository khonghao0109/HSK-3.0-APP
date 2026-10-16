/**
 * Nội dung trang giới thiệu công khai bản web (`/`, M2.10c).
 *
 * Chép từ `docs/ui_reference/web/index.html` theo PO Q84: Luyện tập đã gồm
 * "nghe và chọn" (M2.5c) nên là tính năng ĐÃ CÓ; bốn ô "Sắp có" đúng là
 * Ôn tập, Thi thử HSK, Phát âm, Trợ lý AI. Số từ vựng là số tích luỹ theo
 * chuẩn HSK 3.0 (Q5), cấp 7–9 chung một lộ trình (Q3).
 *
 * Module này cố ý không kéo Zod hay bất cứ thứ gì khác: nó là dữ liệu tĩnh
 * cho cây web, và `client-bundle-guard.spec.ts` cấm Zod vào đồ thị import
 * runtime của client (ADR-008 / CSP không có `unsafe-eval`).
 */

export type LandingNavItem = {
  /** Neo trong trang hoặc route thật. */
  href: string;
  label: string;
};

export type LandingLevel = {
  code: string;
  words: string;
  stage: string;
  /** HSK 7–9 chiếm 2 cột của lưới 4 cột (Q3). */
  wide?: boolean;
};

export type LandingFeatureTone = 'jade' | 'blue' | 'amber' | 'violet';

export type LandingFeature = {
  icon: string;
  tone: LandingFeatureTone;
  title: string;
  text: string;
};

export type LandingSoonItem = {
  icon: string;
  title: string;
};

export type LandingStep = {
  title: string;
  text: string;
};

export type LandingFaqItem = {
  question: string;
  answer: string;
};

/** Đích của mọi lời gọi hành động trên trang (đăng ký/đăng nhập). */
export const LANDING_SIGN_UP_HREF = '/sign-up';
export const LANDING_SIGN_IN_HREF = '/sign-in';

/** Ba neo của thanh điều hướng; `id` tương ứng nằm trên phần tử đích thật. */
export const LANDING_NAV: readonly LandingNavItem[] = [
  { href: '#levels', label: 'Lộ trình HSK' },
  { href: '#features', label: 'Tính năng' },
  { href: '#faq', label: 'Câu hỏi thường gặp' },
];

export const LANDING_HERO = {
  tag: 'Học tiếng Trung theo chuẩn HSK 3.0',
  title: 'Con đường chinh phục tiếng Trung',
  hanzi: '汉路',
  pinyin: 'Hàn lù · Hán Lộ',
  lead: 'Chọn cấp HSK mục tiêu, nhận kế hoạch học mỗi ngày và đi qua từng bài từ vựng, ngữ pháp, luyện tập theo một lộ trình rõ ràng.',
} as const;

export const LANDING_LEVELS: readonly LandingLevel[] = [
  { code: 'HSK 1', words: '~ 500 từ vựng', stage: 'Sơ cấp' },
  { code: 'HSK 2', words: '~ 1.272 từ vựng', stage: 'Sơ cấp' },
  { code: 'HSK 3', words: '~ 2.245 từ vựng', stage: 'Sơ cấp' },
  { code: 'HSK 4', words: '~ 3.245 từ vựng', stage: 'Trung cấp' },
  { code: 'HSK 5', words: '~ 4.316 từ vựng', stage: 'Trung cấp' },
  { code: 'HSK 6', words: '~ 5.456 từ vựng', stage: 'Trung cấp' },
  {
    code: 'HSK 7–9',
    words: '~ 11.092 từ vựng',
    stage: 'Cao cấp · một lộ trình chung cho cấp 7, 8 và 9',
    wide: true,
  },
];

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    icon: 'target',
    tone: 'jade',
    title: 'Lộ trình theo mục tiêu',
    text: 'Chọn cấp HSK và số phút mỗi ngày, bài học mở lần lượt theo cấp.',
  },
  {
    icon: 'book-open',
    tone: 'blue',
    title: 'Bài học',
    text: 'Mỗi bài gồm từ vựng, ngữ pháp và luyện tập.',
  },
  {
    icon: 'search',
    tone: 'amber',
    title: 'Từ điển',
    text: 'Tra chữ Hán, pinyin hoặc nghĩa tiếng Việt, lưu từ để ôn.',
  },
  {
    icon: 'clipboard-check',
    tone: 'violet',
    title: 'Luyện tập',
    text: 'Chọn đáp án, nghe và chọn, sắp xếp câu sau mỗi bài để nhớ từ và ngữ pháp vừa học.',
  },
];

/** Q84: đúng bốn ô "Sắp có" của mẫu, không thêm "Luyện nghe" (đã có, M2.5c). */
export const LANDING_SOON: readonly LandingSoonItem[] = [
  { icon: 'layers', title: 'Ôn tập' },
  { icon: 'trophy', title: 'Thi thử HSK' },
  { icon: 'mic', title: 'Phát âm' },
  { icon: 'sparkles', title: 'Trợ lý AI' },
];

export const LANDING_STEPS: readonly LandingStep[] = [
  { title: 'Đăng ký', text: 'Tạo tài khoản bằng email.' },
  { title: 'Chọn mục tiêu', text: 'Cấp HSK bạn muốn đạt và lý do học.' },
  { title: 'Nhận kế hoạch', text: 'Số phút mỗi ngày và giờ học phù hợp.' },
  { title: 'Học mỗi ngày', text: 'Đi lần lượt từng bài trong lộ trình.' },
];

export const LANDING_FAQ: readonly LandingFaqItem[] = [
  {
    question: 'Hán Lộ dạy theo chuẩn nào?',
    answer:
      'Theo chuẩn HSK 3.0 với chín cấp. Cấp 1 tới 6 có lộ trình riêng; cấp 7, 8 và 9 học chung một lộ trình HSK 7–9.',
  },
  {
    question: 'Tôi chưa biết tiếng Trung, có học được không?',
    answer:
      'Được. Sau khi đăng ký, bạn chọn cấp mục tiêu; bài đầu tiên của mỗi cấp luôn mở để bạn bắt đầu.',
  },
  {
    question: 'Bài học được mở như thế nào?',
    answer:
      'Trong mỗi cấp, bài sau mở khi bạn hoàn thành bài liền trước. Bài đã học dở không bao giờ bị khoá lại.',
  },
  {
    question: 'Mỗi ngày nên học bao lâu?',
    answer: 'Bạn chọn 10, 15 hoặc 30 phút mỗi ngày khi lập kế hoạch.',
  },
  {
    question: 'Khi nào có Ôn tập, Thi thử, Phát âm và Trợ lý AI?',
    answer:
      'Các tính năng gắn nhãn "Sắp có" đang được phát triển và sẽ mở trong ứng dụng khi sẵn sàng.',
  },
];

// Chân trang dùng chung nằm ở `features/learner-shell/learner-public-footer.tsx`
// (nó phục vụ cả `/`, `/terms`, `/privacy` nên không thuộc nhóm landing).
