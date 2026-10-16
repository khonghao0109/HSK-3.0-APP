import { Inter, Noto_Sans_SC } from 'next/font/google';

/**
 * Font admin (M5.0): đúng họ/weight learner đang nạp ở
 * `src/app/(learner)/layout.tsx` — Inter (400/500/600/700, latin + vietnamese)
 * và Noto Sans SC (400/500/700, preload: false). Không thêm họ font mới.
 * Module dùng chung cho `src/app/admin/layout.tsx` và `src/app/(auth)`/… để
 * không tạo hai instance next/font cho cùng một họ.
 */
export const adminFontInter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

export const adminFontNotoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  preload: false,
  variable: '--font-noto-sans-sc',
  display: 'swap',
});

export const adminFontClassNames = [
  adminFontInter.variable,
  adminFontNotoSansSC.variable,
] as const;
