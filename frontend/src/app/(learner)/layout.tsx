import type { Metadata } from 'next';
import { Inter, Noto_Serif, Noto_Serif_SC } from 'next/font/google';
import type { ReactNode } from 'react';

import './learner.css';

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

const notoSerifSC = Noto_Serif_SC({
  weight: ['500', '700'],
  preload: false,
  variable: '--font-noto-serif-sc',
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
      className={`learner-app ${inter.variable} ${notoSerif.variable} ${notoSerifSC.variable}`}
      lang="vi"
    >
      <div hidden aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="i-arrow-left" viewBox="0 0 24 24">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
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
          <symbol id="i-check-circle" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
            <path
              d="m8 12.5 2.8 2.8L16.5 9.5"
              stroke="var(--white)"
              strokeWidth="2.2"
            />
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
        </svg>
      </div>
      {children}
    </div>
  );
}
