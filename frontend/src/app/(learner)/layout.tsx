import type { Metadata } from 'next';
import {
  Inter,
  LXGW_WenKai_TC,
  Noto_Sans_SC,
  Noto_Serif,
  Noto_Serif_SC,
} from 'next/font/google';
import type { ReactNode } from 'react';

import './learner.css';
import './learner-web.css';
import './learner-web-public.css';
import './learner-web-landing.css';
import './learner-web-legal.css';
import './learner-web-auth.css';
import './learner-web-onboarding.css';

const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSerif = Noto_Serif({
  weight: ['600', '700'],
  subsets: ['latin', 'vietnamese'],
  variable: '--font-noto-serif',
  display: 'swap',
});

const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  preload: false,
  variable: '--font-noto-sans-sc',
  display: 'swap',
});

const notoSerifSC = Noto_Serif_SC({
  // 400: Tra từ rows and example sentence (m03.css, M2.6b).
  weight: ['400', '500', '700'],
  preload: false,
  variable: '--font-noto-serif-sc',
  display: 'swap',
});

// Kai face of the module 03 headwords (m03.css --m03-font-kai, M2.6b).
const lxgwWenKai = LXGW_WenKai_TC({
  weight: '700',
  preload: false,
  variable: '--font-lxgw-wenkai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Hán Lộ',
    template: '%s · Hán Lộ',
  },
};

export default function LearnerLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`learner-app ${inter.variable} ${notoSerif.variable} ${notoSerifSC.variable} ${notoSansSC.variable} ${lxgwWenKai.variable}`}
      lang="vi"
    >
      <div hidden aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="i-arrow-left" viewBox="0 0 24 24">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </symbol>
          <symbol id="i-arrow-right" viewBox="0 0 24 24">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </symbol>
          <symbol id="i-lock-fill" viewBox="0 0 24 24">
            <path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" />
            <rect
              x="4"
              y="10"
              width="16"
              height="11.5"
              rx="2.2"
              fill="currentColor"
              stroke="none"
            />
          </symbol>
          <symbol id="i-chevron-right" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </symbol>
          <symbol id="i-mail" viewBox="0 0 24 24">
            <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
            <path d="m3 6.5 9 6.5 9-6.5" />
          </symbol>
          <symbol id="i-lock" viewBox="0 0 24 24">
            <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
            <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
            <path d="M12 15v2" />
          </symbol>
          <symbol id="i-eye" viewBox="0 0 24 24">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </symbol>
          <symbol id="i-eye-off" viewBox="0 0 24 24">
            <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.16 3.19" />
            <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 8 10 8a9.3 9.3 0 0 0 5.4-1.6" />
            <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" />
            <path d="m2 2 20 20" />
          </symbol>
          <symbol id="i-alert-triangle" viewBox="0 0 24 24">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </symbol>
          <symbol id="i-heart" viewBox="0 0 24 24">
            <path d="M19.5 12.6 12 20l-7.5-7.4A4.9 4.9 0 0 1 12 6.1a4.9 4.9 0 0 1 7.5 6.5Z" />
          </symbol>
          <symbol id="i-x" viewBox="0 0 24 24">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </symbol>
          <symbol id="i-x-circle" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
            <path
              d="m9 9 6 6M15 9l-6 6"
              stroke="var(--white)"
              strokeWidth="2.2"
            />
          </symbol>
          <symbol id="i-check-circle" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
            <path
              d="m8 12.5 2.8 2.8L16.5 9.5"
              stroke="var(--white)"
              strokeWidth="2.2"
            />
          </symbol>
          <symbol id="i-volume-fill" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              stroke="none"
              d="M3 9.2c0-.66.54-1.2 1.2-1.2H7l4.4-3.6c.66-.54 1.6-.07 1.6.77v13.66c0 .84-.94 1.31-1.6.77L7 16H4.2A1.2 1.2 0 0 1 3 14.8Z"
            />
            <path d="M16 9a4.2 4.2 0 0 1 0 6" />
            <path d="M18.8 6.5a8 8 0 0 1 0 11" />
          </symbol>
          <symbol id="i-pause" viewBox="0 0 24 24">
            <rect
              x="6"
              y="5"
              width="4"
              height="14"
              rx="1"
              fill="currentColor"
              stroke="none"
            />
            <rect
              x="14"
              y="5"
              width="4"
              height="14"
              rx="1"
              fill="currentColor"
              stroke="none"
            />
          </symbol>
          <symbol id="i-rotate-ccw" viewBox="0 0 24 24">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </symbol>
          <symbol id="i-star-fill" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              stroke="none"
              d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"
            />
          </symbol>
          <symbol id="i-clock" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 7v5l3 2" />
          </symbol>
          <symbol id="i-bell" viewBox="0 0 24 24">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </symbol>
          <symbol id="i-sparkles" viewBox="0 0 24 24">
            <path d="M12 3 13.9 8.1 19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
            <path d="M19 15v4M17 17h4" />
            <path d="M5 3v3M3.5 4.5h3" />
          </symbol>
          <symbol id="i-home" viewBox="0 0 24 24">
            <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
          </symbol>
          <symbol id="i-home-fill" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              stroke="none"
              d="M11.36 2.23a1 1 0 0 1 1.28 0l8.64 7.2a1 1 0 0 1 .36.77V20a1.5 1.5 0 0 1-1.5 1.5h-4.64v-6.25H8.5v6.25H3.86A1.5 1.5 0 0 1 2.36 20v-9.8a1 1 0 0 1 .36-.77Z"
            />
          </symbol>
          <symbol id="i-book-open" viewBox="0 0 24 24">
            <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2Z" />
            <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z" />
          </symbol>
          <symbol id="i-book-open-fill" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              stroke="none"
              d="M2 4.2c0-.66.54-1.2 1.2-1.2H8a4.2 4.2 0 0 1 3.2 1.48V21a3.6 3.6 0 0 0-2.7-1.2H3.2A1.2 1.2 0 0 1 2 18.6Zm20 0c0-.66-.54-1.2-1.2-1.2H16a4.2 4.2 0 0 0-3.2 1.48V21a3.6 3.6 0 0 1 2.7-1.2h5.3a1.2 1.2 0 0 0 1.2-1.2Z"
            />
            <path d="M12 9.5v4" stroke="var(--white)" strokeWidth="2" />
          </symbol>
          <symbol id="i-book-open-text" viewBox="0 0 24 24">
            <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2Z" />
            <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7Z" />
            <path d="M5.5 9h3M5.5 12.5h3" />
            <circle cx="7" cy="6.6" r=".9" fill="currentColor" stroke="none" />
          </symbol>
          <symbol id="i-book-marked" viewBox="0 0 24 24">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            <path d="M10 2v8l3-3 3 3V2" />
          </symbol>
          <symbol id="i-search" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </symbol>
          <symbol id="i-layers" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="5" rx="1.5" />
            <rect x="3" y="11" width="18" height="5" rx="1.5" />
            <path d="M7 20h10" />
          </symbol>
          <symbol id="i-user" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </symbol>
          <symbol id="i-trophy" viewBox="0 0 24 24">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
            <path d="M18 2H6v7a6 6 0 0 0 12 0Z" />
          </symbol>
          <symbol id="i-mic" viewBox="0 0 24 24">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <path d="M12 18v4" />
          </symbol>
          <symbol id="i-file-text" viewBox="0 0 24 24">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
            <path d="M14 2v6h6" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
            <path d="M10 9H8" />
          </symbol>
          <symbol id="i-message-circle" viewBox="0 0 24 24">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </symbol>
          <symbol id="i-file-stack" viewBox="0 0 24 24">
            <path d="M16 2v5h5" />
            <path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17Z" />
            <path d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15" />
            <path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11" />
          </symbol>
          <symbol id="i-help-circle" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </symbol>
          <symbol id="i-chevron-left" viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </symbol>
          <symbol id="i-history" viewBox="0 0 24 24">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </symbol>
          <symbol id="i-m03-clear" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="11" fill="currentColor" stroke="none" />
            <path
              d="m8.2 8.2 7.6 7.6M15.8 8.2l-7.6 7.6"
              stroke="var(--white)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.6"
            />
          </symbol>
          <symbol id="i-m03-pen" viewBox="0 0 24 24">
            <path d="M3.5 21.5h17" />
            <path d="M15.2 3.6a2.3 2.3 0 0 1 3.2 3.2L8.6 16.6 4.5 18l1.4-4.1Z" />
          </symbol>
          <symbol id="i-camera" viewBox="0 0 24 24">
            <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z" />
            <circle cx="12" cy="13" r="3.5" />
          </symbol>
          <symbol id="i-m03-mic" viewBox="0 0 24 24">
            <rect
              x="8.5"
              y="2"
              width="7"
              height="12.5"
              rx="3.5"
              fill="currentColor"
              stroke="none"
            />
            <path d="M19 10.5a7 7 0 0 1-14 0" />
            <path d="M12 17.5V22" />
          </symbol>
          <symbol id="i-m03-read" viewBox="0 0 24 24">
            <path d="M2.5 4.5H9a3 3 0 0 1 3 3V20a2.4 2.4 0 0 0-2.4-2H2.5Z" />
            <path d="M21.5 4.5H15a3 3 0 0 0-3 3V20a2.4 2.4 0 0 1 2.4-2h7.1Z" />
            <path d="M8.5 10v1.5M15.5 10v1.5" />
          </symbol>
          <symbol id="i-file-question" viewBox="0 0 24 24">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
            <path d="M14 2v6h6" />
            <path d="M10 11a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.5" />
            <path d="M12 17.5h.01" />
          </symbol>
          <symbol id="i-more-vertical" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </symbol>
          <symbol id="i-copy" viewBox="0 0 24 24">
            <rect x="8" y="8" width="14" height="14" rx="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </symbol>
          <symbol id="i-flag" viewBox="0 0 24 24">
            <path d="M4 22V4s1.5-1 4.5-1 5 2 8 2 3.5-1 3.5-1v11s-1 1-3.5 1-5-2-8-2S4 15 4 15" />
          </symbol>
          <symbol id="i-pen-line" viewBox="0 0 24 24">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </symbol>
          <symbol id="i-check" viewBox="0 0 24 24">
            <path d="M20 6 9 17l-5-5" />
          </symbol>
          {/* M4.2a (TL-119): ba symbol của màn giới thiệu đề, chép path từ
              `docs/ui_reference/shared/js/icons.js` (play giữ
              `fill="currentColor" stroke="none"`). */}
          <symbol id="i-list" viewBox="0 0 24 24">
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
          </symbol>
          <symbol id="i-play" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              stroke="none"
              d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.2-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14Z"
            />
          </symbol>
          <symbol id="i-rotate-cw" viewBox="0 0 24 24">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </symbol>
          <symbol id="logo-google" viewBox="0 0 24 24">
            <path
              fill="var(--logo-google-blue)"
              d="M23.5 12.27c0-.8-.07-1.57-.2-2.3H12v4.35h6.45a5.5 5.5 0 0 1-2.4 3.62v3h3.87c2.27-2.09 3.58-5.17 3.58-8.67Z"
            />
            <path
              fill="var(--logo-google-green)"
              d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.87-3a7.2 7.2 0 0 1-10.73-3.78h-4v3.1A12 12 0 0 0 12 24Z"
            />
            <path
              fill="var(--logo-google-yellow)"
              d="M5.35 14.32a7.2 7.2 0 0 1 0-4.64v-3.1h-4a12 12 0 0 0 0 10.84Z"
            />
            <path
              fill="var(--logo-google-red)"
              d="M12 4.77c1.76 0 3.35.6 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 1.35 6.58l4 3.1A7.15 7.15 0 0 1 12 4.77Z"
            />
          </symbol>
          <symbol id="logo-apple" viewBox="0 0 24 24">
            <path
              fill="var(--logo-apple-black)"
              d="M16.37 12.73c-.02-2.33 1.9-3.45 1.99-3.5a4.3 4.3 0 0 0-3.37-1.82c-1.42-.15-2.8.85-3.53.85-.74 0-1.86-.83-3.06-.81a4.52 4.52 0 0 0-3.8 2.32c-1.64 2.84-.42 7.02 1.16 9.32.79 1.13 1.71 2.39 2.92 2.34 1.18-.05 1.62-.75 3.04-.75 1.41 0 1.82.75 3.05.72 1.27-.02 2.07-1.14 2.83-2.28a9.6 9.6 0 0 0 1.29-2.64 4.06 4.06 0 0 1-2.52-3.75ZM14.05 5.88A4.1 4.1 0 0 0 15 2.93a4.2 4.2 0 0 0-2.73 1.41 3.9 3.9 0 0 0-.97 2.86 3.48 3.48 0 0 0 2.75-1.32Z"
            />
          </symbol>
          <symbol id="logo-facebook" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="var(--logo-facebook-blue)" />
            <path
              fill="var(--logo-facebook-white)"
              d="M16.67 15.47 17.2 12h-3.33V9.75c0-.95.47-1.88 1.95-1.88h1.51V4.91s-1.37-.23-2.68-.23c-2.74 0-4.53 1.66-4.53 4.66V12H7.08v3.47h3.04V24a12.1 12.1 0 0 0 3.75 0v-8.53Z"
            />
          </symbol>
          {/* Năm hình mà 10 trang mẫu web công khai dùng nhưng sprite còn
              thiếu (V5). Đường dẫn chép nguyên từ
              `docs/ui_reference/shared/js/icons.js`:
              check-circle-line (dòng 50), chevron-down (8), info (62),
              target (90), clipboard-check (102). */}
          <symbol id="i-check-circle-line" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9.5" />
            <path d="m8 12.5 2.8 2.8L16.5 9.5" />
          </symbol>
          <symbol id="i-chevron-down" viewBox="0 0 24 24">
            <path d="m6 9 6 6 6-6" />
          </symbol>
          <symbol id="i-info" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </symbol>
          <symbol id="i-target" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9.5" />
            <circle cx="12" cy="12" r="5.5" />
            <circle cx="12" cy="12" r="1.5" />
          </symbol>
          <symbol id="i-clipboard-check" viewBox="0 0 24 24">
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <path d="m9 14 2 2 4-4" />
          </symbol>
        </svg>
      </div>
      {children}
    </div>
  );
}
