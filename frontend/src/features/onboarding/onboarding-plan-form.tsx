'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { LearnerBrand } from '@/features/learner-shell/learner-brand';

import { localDateString, type LearningPurpose } from './onboarding-values';
import { ONBOARDING_ERROR_MESSAGES } from './onboarding-messages';
import { useRadioGroup } from './use-radio-group';

const MINUTES = [10, 15, 30] as const;
type DailyMinutes = (typeof MINUTES)[number];

/* Step indicator of the onboarding flow (Q8: the plan screen is 2/4). Shared
   by the mobile chrome and the web nav (`.obw-steps`) so they cannot drift. */
const STEP_INDEX = 2;
const STEP_TOTAL = 4;
const STEP_MARKS = [1, 2, 3, 4] as const;

/* Nhãn mục tiêu học tập cho panel tóm tắt bản web. Bản mobile của màn Kế
   hoạch không hiển thị nhãn này nên không dùng chung được với màn Mục tiêu. */
const PURPOSE_LABELS: Record<LearningPurpose, string> = {
  communication: 'Giao tiếp',
  study_abroad: 'Du học',
  hsk_exam: 'Thi HSK',
  work: 'Công việc',
};

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
  const backHref = `/onboarding/goal?purpose=${purpose}&band=${band}`;

  return (
    <div className="w-public">
      {/* Nav web (chỉ từ 1024px; mẫu web/onboarding-plan.html + css/onboarding.css). */}
      <header className="w-pubnav obw-nav w-only">
        <Link className="icon-btn" href={backHref} aria-label="Quay lại">
          <svg className="icon" aria-hidden="true">
            <use href="#i-arrow-left" />
          </svg>
        </Link>
        <LearnerBrand href="/learn" />
        <div className="obw-steps">
          <ol aria-hidden="true">
            {STEP_MARKS.map((mark) => (
              <li
                key={mark}
                className={mark <= STEP_INDEX ? 'is-done' : undefined}
              />
            ))}
          </ol>
          <span aria-label={`Bước ${STEP_INDEX} trên ${STEP_TOTAL}`}>
            {STEP_INDEX}/{STEP_TOTAL}
          </span>
        </div>
      </header>

      <main className="app ob w-wrap obw-body w-grid w-grid--main-aside">
        <div className="obw-col">
          <div className="ob__top m-only">
            <Link className="icon-btn" href={backHref} aria-label="Quay lại">
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
              <span aria-hidden="true">
                {STEP_INDEX}/{STEP_TOTAL}
              </span>
              <span className="sr-only">
                {`Bước ${STEP_INDEX} trên ${STEP_TOTAL}`}
              </span>
            </p>
          </div>

          <h1 className="ob__title w-h1">
            {/* `{' '}` giữ đúng khoảng cách của mẫu khi bản web ẩn `<br>` (V2).
                Khoảng trắng cuối dòng bị CSS bỏ trên mobile nên không xê dịch
                pixel. */}
            <span>Bạn muốn học mỗi ngày</span> <br />
            <span>bao nhiêu phút?</span>
          </h1>
          <p className="ob__sub w-lead">
            Duy trì thói quen nhỏ, đạt thành tựu lớn
          </p>

          <div
            className="minutes obw-minutes w-grid w-grid--3"
            role="radiogroup"
            aria-label="Số phút mỗi ngày"
            id="minutes"
          >
            <button
              className="minute obw-minute"
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
              <svg className="obw-minute__check w-only" aria-hidden="true">
                <use href="#i-check-circle" />
              </svg>
            </button>
            <button
              className="minute obw-minute"
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
              <svg className="obw-minute__check w-only" aria-hidden="true">
                <use href="#i-check-circle" />
              </svg>
            </button>
            <button
              className="minute minute--fast obw-minute obw-minute--fast"
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
              <svg className="obw-minute__check w-only" aria-hidden="true">
                <use href="#i-check-circle" />
              </svg>
            </button>
          </div>

          <h2 className="ob__h2 ob__section w-h3">Bạn muốn học vào lúc nào?</h2>
          <div className="obw-when w-grid w-grid--2">
            <label className="time-select obw-time">
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

            <div className="remind obw-remind w-card">
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
          </div>

          {/* Gợi ý đứng sau khối giờ học trong DOM (đúng thứ tự mobile);
              từ 1024px CSS `order` đưa nó lên ngay dưới dãy phút như mẫu. */}
          <p className="tip obw-tip" aria-live="polite">
            <svg className="icon" aria-hidden="true">
              <use href="#i-sparkles" />
            </svg>
            <span className="obw-tip__text" id="tip">
              <span>{tip[0]}</span> <br />
              <span>{tip[1]}</span>
            </span>
          </p>
        </div>

        {/* Panel tóm tắt = `.ob__footer` của mobile: giữ đúng một nút "Tiếp
            tục" trong DOM (Q78) và đúng một `role="alert"`. */}
        <div className="ob__footer w-card obw-summary">
          <div className="obw-summary__panel w-only">
            <h2 className="w-h3" id="sum-title">
              Lựa chọn của bạn
            </h2>
            <dl className="obw-summary__list">
              <div>
                <dt>Mục tiêu</dt>
                <dd id="sum-goal">{PURPOSE_LABELS[purpose]}</dd>
              </div>
              <div>
                <dt>Trình độ mục tiêu</dt>
                <dd id="sum-level">{`HSK ${band}`}</dd>
              </div>
              <div>
                <dt>Mỗi ngày</dt>
                <dd id="sum-min">{`${dailyMinutes} phút`}</dd>
              </div>
              <div>
                <dt>Giờ học</dt>
                <dd id="sum-time">{reminderTime}</dd>
              </div>
              <div>
                <dt>Nhắc nhở</dt>
                <dd id="sum-remind">{reminderEnabled ? 'Bật' : 'Tắt'}</dd>
              </div>
            </dl>
          </div>
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
            <svg className="icon obw-cta__arrow w-only" aria-hidden="true">
              <use href="#i-arrow-right" />
            </svg>
          </button>
          <p className="obw-summary__note w-only">
            <svg className="icon" aria-hidden="true">
              <use href="#i-info" />
            </svg>
            Tiếp theo: tạo lộ trình học của bạn.
          </p>
        </div>
      </main>
    </div>
  );
}
