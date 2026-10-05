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
