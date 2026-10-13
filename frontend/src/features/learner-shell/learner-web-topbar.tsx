import Link from 'next/link';

import { ToastButton } from './learner-toast';
import { TOAST_NOTIFICATIONS } from './learner-toast-messages';

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * Top bar of the `.w-app` frame from 1024px (Q81), first in the page so Tab
 * runs sidebar → top bar → main. `search={false}` on Tra từ, which has its
 * own box (Q85). `streakDays` only from the API the page already calls
 * (Q83); without it there is no chip.
 */
export function LearnerWebTopbar({
  search = true,
  streakDays = null,
}: {
  search?: boolean;
  streakDays?: number | null;
}) {
  return (
    <div className="w-top w-only">
      {search && (
        <form className="w-search" role="search" action="/learn/dictionary">
          <Icon name="search" />
          <input
            type="search"
            name="q"
            aria-label="Tra từ"
            placeholder="Tra chữ Hán, pinyin hoặc nghĩa tiếng Việt"
            autoComplete="off"
          />
        </form>
      )}
      <div className="w-top__end">
        {streakDays !== null && (
          <span className="w-chip">
            <img src="/images/learner/fire.png" alt="" width={20} height={20} />
            <span className="sr-only">Chuỗi ngày học: </span>
            {streakDays}
            <span className="sr-only"> ngày</span>
          </span>
        )}
        <ToastButton
          className="icon-btn"
          aria-label="Thông báo"
          message={TOAST_NOTIFICATIONS}
        >
          <Icon name="bell" />
        </ToastButton>
        <Link className="w-top__me" href="/learn/profile" aria-label="Hồ sơ">
          <Icon name="user" />
        </Link>
      </div>
    </div>
  );
}
