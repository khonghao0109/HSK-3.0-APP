/**
 * Sprite icon admin (M5.0): chép nguyên đường nét từ
 * `docs/ui_reference/shared/js/icons.js` (id → dòng nguồn ghi bên dưới) và
 * `docs/ui_reference/shared/js/icons-m06.js` (riêng `archive`, dòng 4).
 * Mount một lần trong AdminShell; `<use href="#i-…">` tham chiếu symbol.
 *
 * Nguồn (icons.js): leaf 89, layout-dashboard 80, file-stack 81,
 * clipboard-check 102, image 70, file-question 82, upload 43, users 24,
 * bar-chart 84, cpu 85, message-circle 67, settings 29, menu 79, user 23,
 * log-out 88, plus 76, search 21, x 11, filter 78, chevron-left 6,
 * chevron-right 7, eye 14, pencil 32, alert-triangle 92, rotate-ccw 38.
 * `clipboard-list` (TL-106, mục "Đề thi") không có trong icons.js: vẽ mới
 * cùng nét 2px/round như `clipboard-check` để sidebar admin đồng bộ.
 */
export function AdminIconSprite() {
  return (
    <div hidden aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg">
        <symbol id="i-leaf" viewBox="0 0 24 24">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
        </symbol>
        <symbol id="i-layout-dashboard" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </symbol>
        <symbol id="i-file-stack" viewBox="0 0 24 24">
          <path d="M16 2v5h5" />
          <path d="M21 6v6.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-9c0-.8.7-1.5 1.5-1.5H17Z" />
          <path d="M7 8v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H15" />
          <path d="M3 12v8.8c0 .3.2.6.4.8.2.2.5.4.8.4H11" />
        </symbol>
        <symbol id="i-clipboard-check" viewBox="0 0 24 24">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </symbol>
        <symbol id="i-clipboard-list" viewBox="0 0 24 24">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M8 11h8M8 15h8M8 19h5" />
        </symbol>
        <symbol id="i-image" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
        </symbol>
        <symbol id="i-file-question" viewBox="0 0 24 24">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
          <path d="M14 2v6h6" />
          <path d="M10 11a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.5" />
          <path d="M12 17.5h.01" />
        </symbol>
        <symbol id="i-upload" viewBox="0 0 24 24">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m17 8-5-5-5 5" />
          <path d="M12 3v12" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
          <path d="M18 14a6 6 0 0 1 3.5 6" />
        </symbol>
        <symbol id="i-bar-chart" viewBox="0 0 24 24">
          <path d="M3 3v18h18" />
          <path d="M8 17V11M13 17V7M18 17v-4" />
        </symbol>
        <symbol id="i-cpu" viewBox="0 0 24 24">
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </symbol>
        <symbol id="i-message-circle" viewBox="0 0 24 24">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </symbol>
        <symbol id="i-settings" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8.3l.1.1a2 2 0 1 1 2.8 2.8l.1.1a1.7 1.7 0 0 0 .3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </symbol>
        <symbol id="i-user" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </symbol>
        <symbol id="i-log-out" viewBox="0 0 24 24">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </symbol>
        <symbol id="i-plus" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </symbol>
        <symbol id="i-x" viewBox="0 0 24 24">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </symbol>
        <symbol id="i-filter" viewBox="0 0 24 24">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54Z" />
        </symbol>
        <symbol id="i-chevron-left" viewBox="0 0 24 24">
          <path d="m15 18-6-6 6-6" />
        </symbol>
        <symbol id="i-chevron-right" viewBox="0 0 24 24">
          <path d="m9 18 6-6-6-6" />
        </symbol>
        <symbol id="i-eye" viewBox="0 0 24 24">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </symbol>
        <symbol id="i-pencil" viewBox="0 0 24 24">
          <path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </symbol>
        <symbol id="i-alert-triangle" viewBox="0 0 24 24">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </symbol>
        <symbol id="i-rotate-ccw" viewBox="0 0 24 24">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </symbol>
        <symbol id="i-archive" viewBox="0 0 24 24">
          <rect x="2" y="3" width="20" height="5" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </symbol>
      </svg>
    </div>
  );
}
