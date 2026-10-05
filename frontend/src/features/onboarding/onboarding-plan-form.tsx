'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { localDateString, type LearningPurpose } from './onboarding-contract';
import { ONBOARDING_ERROR_MESSAGES } from './onboarding-messages';
import { useRadioGroup } from './use-radio-group';

const MINUTES = [10, 15, 30] as const;
type DailyMinutes = (typeof MINUTES)[number];

export const PLAN_TIPS: Record<DailyMinutes, [string, string]> = {
  10: [
    'Học 10 phút mỗi ngày là khởi đầu nhẹ nhàng',
    'để hình thành thói quen.',
  ],
  15: ['Học 15 phút mỗi ngày giúp bạn nhớ lâu hơn', 'và tiến bộ bền vững.'],
  30: ['Học 30 phút mỗi ngày giúp bạn tăng tốc', 'và lên cấp nhanh hơn.'],
};

const TIME_OPTIONS = [
  '06:30',
  '07:00',
  '12:00',
  '18:00',
  '19:00',
  '20:00',
  '21:00',
  '22:00',
];

export function OnboardingPlanForm({
  purpose,
  band,
  initialDailyMinutes,
  initialReminderEnabled,
  initialReminderTime,
}: {
  purpose: LearningPurpose;
  band: number;
  initialDailyMinutes: DailyMinutes;
  initialReminderEnabled: boolean;
  initialReminderTime: string;
}) {
  const router = useRouter();
  const submittingRef = useRef(false);

  const [dailyMinutes, setDailyMinutes] =
    useState<DailyMinutes>(initialDailyMinutes);
  const [reminderEnabled, setReminderEnabled] = useState<boolean>(
    initialReminderEnabled,
  );
  const [reminderTime, setReminderTime] = useState<string>(initialReminderTime);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorLink, setErrorLink] = useState<{
    href: string;
    label: string;
  } | null>(null);

  const minutesGroup = useRadioGroup({
    items: MINUTES,
    onChange: setDailyMinutes,
  });

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    setErrorLink(null);

    try {
      const payload = {
        learningPurpose: purpose,
        targetBand: band,
        dailyMinutes,
        reminderEnabled,
        reminderTime: reminderEnabled ? reminderTime : null,
        startDate: localDateString(new Date()),
      };

      const response = await fetch('/api/learner/onboarding/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 200) {
        router.replace('/learn');
        return;
      }

      submittingRef.current = false;
      setPending(false);

      if (response.status === 401) {
        router.replace('/sign-in');
        return;
      }

      const data: unknown = await response.json().catch(() => null);
      const kind =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof (data as { error?: { kind?: unknown } }).error?.kind === 'string'
          ? (data as { error: { kind: string } }).error.kind
          : null;

      if (kind === 'content_unavailable') {
        setErrorMessage(ONBOARDING_ERROR_MESSAGES.contentUnavailable);
        setErrorLink({
          href: `/onboarding/goal?purpose=${purpose}&band=${band}&notice=content_unavailable`,
          label: ONBOARDING_ERROR_MESSAGES.changeLevelLinkText,
        });
      } else if (kind === 'level_unavailable') {
        setErrorMessage(ONBOARDING_ERROR_MESSAGES.levelUnavailable);
        setErrorLink({
          href: `/onboarding/goal?purpose=${purpose}&band=${band}`,
          label: ONBOARDING_ERROR_MESSAGES.changeLevelLinkText,
        });
      } else if (kind === 'conflict') {
        setErrorMessage(ONBOARDING_ERROR_MESSAGES.conflict);
      } else if (response.status === 429) {
        setErrorMessage(ONBOARDING_ERROR_MESSAGES.rateLimited);
      } else {
        setErrorMessage(ONBOARDING_ERROR_MESSAGES.generic);
      }
    } catch {
      submittingRef.current = false;
      setPending(false);
      setErrorMessage(ONBOARDING_ERROR_MESSAGES.network);
    }
  };

  const tip = PLAN_TIPS[dailyMinutes];

  return (
    <main className="app ob">
      <div className="ob__top">
        <Link
          className="icon-btn"
          href={`/onboarding/goal?purpose=${purpose}&band=${band}`}
          aria-label="Quay lại"
        >
          <svg className="icon" aria-hidden="true">
            <use href="#i-arrow-left" />
          </svg>
        </Link>
        <div className="ob__dots" aria-hidden="true">
          <i />
          <i className="is-on" />
          <i />
          <i />
          <i />
          <i />
        </div>
        <p className="ob__step">
          <span aria-hidden="true">2/4</span>
          <span className="sr-only">Bước 2 trên 4</span>
        </p>
      </div>

      <h1 className="ob__title">
        Bạn muốn học mỗi ngày
        <br />
        bao nhiêu phút?
      </h1>
      <p className="ob__sub">Duy trì thói quen nhỏ, đạt thành tựu lớn</p>

      <div
        className="minutes"
        role="radiogroup"
        aria-label="Số phút mỗi ngày"
        id="minutes"
      >
        <button
          className="minute"
          type="button"
          role="radio"
          aria-checked={dailyMinutes === 10}
          tabIndex={dailyMinutes === 10 ? 0 : -1}
          data-min="10"
          onClick={() => setDailyMinutes(10)}
          onKeyDown={(e) => minutesGroup.handleKeyDown(e, 0)}
        >
          <b>10</b>
          <span>phút</span>
          <small>Khởi đầu</small>
        </button>
        <button
          className="minute"
          type="button"
          role="radio"
          aria-checked={dailyMinutes === 15}
          tabIndex={dailyMinutes === 15 ? 0 : -1}
          data-min="15"
          onClick={() => setDailyMinutes(15)}
          onKeyDown={(e) => minutesGroup.handleKeyDown(e, 1)}
        >
          <b>15</b>
          <span>phút</span>
          <small>Cân bằng</small>
        </button>
        <button
          className="minute minute--fast"
          type="button"
          role="radio"
          aria-checked={dailyMinutes === 30}
          tabIndex={dailyMinutes === 30 ? 0 : -1}
          data-min="30"
          onClick={() => setDailyMinutes(30)}
          onKeyDown={(e) => minutesGroup.handleKeyDown(e, 2)}
        >
          <b>30</b>
          <span>phút</span>
          <small>Tăng tốc</small>
        </button>
      </div>

      <h2 className="ob__h2 ob__section">Bạn muốn học vào lúc nào?</h2>
      <label className="time-select">
        <span className="sr-only">Giờ học mỗi ngày</span>
        <svg className="icon" aria-hidden="true">
          <use href="#i-clock" />
        </svg>
        <select
          className="input"
          value={reminderTime}
          onChange={(e) => setReminderTime(e.target.value)}
        >
          {TIME_OPTIONS.map((time) => (
            <option key={time} value={time}>
              {time}
            </option>
          ))}
        </select>
      </label>

      <div className="remind">
        <svg className="icon" aria-hidden="true">
          <use href="#i-bell" />
        </svg>
        <div className="grow">
          <strong id="remind-label">Nhận nhắc nhở học tập</strong>
          <small id="remind-desc">
            Nhắc nhở sẽ được gửi khi tính năng ra mắt
          </small>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={reminderEnabled}
            onChange={(e) => setReminderEnabled(e.target.checked)}
            aria-labelledby="remind-label"
            aria-describedby="remind-desc"
          />
          <span />
        </label>
      </div>

      <p className="tip" aria-live="polite">
        <svg className="icon" aria-hidden="true">
          <use href="#i-sparkles" />
        </svg>
        <span id="tip">
          {tip[0]}
          <br />
          {tip[1]}
        </span>
      </p>

      <div className="ob__footer">
        {errorMessage && (
          <div className="alert alert--error" role="alert">
            <svg className="icon icon--sm" aria-hidden="true">
              <use href="#i-alert-triangle" />
            </svg>
            <span>
              {errorMessage}
              {errorLink && (
                <>
                  {' '}
                  <Link href={errorLink.href}>{errorLink.label}</Link>
                </>
              )}
            </span>
          </div>
        )}
        <button
          className="btn btn--primary btn--block"
          type="button"
          disabled={pending}
          aria-busy={pending ? 'true' : undefined}
          onClick={handleSubmit}
        >
          {pending ? 'Đang lưu…' : 'Tiếp tục'}
        </button>
      </div>
    </main>
  );
}
