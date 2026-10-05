'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ONBOARDING_ERROR_MESSAGES } from './onboarding-messages';
import {
  parseGoalPageSearchParams,
  resolveLevelForBand,
  type LearningPurpose,
  type LevelItem,
} from './onboarding-contract';
import { useRadioGroup } from './use-radio-group';

const PURPOSES: Array<{
  id: LearningPurpose;
  label: string;
  img: string;
}> = [
  {
    id: 'communication',
    label: 'Giao tiếp',
    img: '/images/learner/goal-communication.png',
  },
  {
    id: 'study_abroad',
    label: 'Du học',
    img: '/images/learner/goal-study-abroad.png',
  },
  {
    id: 'hsk_exam',
    label: 'Thi HSK',
    img: '/images/learner/goal-hsk.png',
  },
  {
    id: 'work',
    label: 'Công việc',
    img: '/images/learner/goal-work.png',
  },
];

const PURPOSE_IDS: readonly LearningPurpose[] = [
  'communication',
  'study_abroad',
  'hsk_exam',
  'work',
] as const;

const BANDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const LEVEL_ALERT_ID = 'level-alert';

export const LEVELS_INFO: Record<
  number,
  { title: string; desc: [string, string] }
> = {
  1: {
    title: 'HSK 1 ~ 500 từ vựng',
    desc: ['Hiểu và dùng các câu rất đơn giản', 'trong giao tiếp cơ bản.'],
  },
  2: {
    title: 'HSK 2 ~ 1.272 từ vựng',
    desc: ['Trao đổi trực tiếp về các chủ đề', 'quen thuộc hằng ngày.'],
  },
  3: {
    title: 'HSK 3 ~ 2.245 từ vựng',
    desc: ['Có thể giao tiếp trong các tình huống', 'hàng ngày đơn giản.'],
  },
  4: {
    title: 'HSK 4 ~ 3.245 từ vựng',
    desc: [
      'Thảo luận nhiều chủ đề và giao tiếp',
      'trôi chảy với người bản ngữ.',
    ],
  },
  5: {
    title: 'HSK 5 ~ 4.316 từ vựng',
    desc: ['Đọc báo, xem phim và diễn đạt', 'ý kiến mạch lạc.'],
  },
  6: {
    title: 'HSK 6 ~ 5.456 từ vựng',
    desc: [
      'Hiểu thông tin phức tạp và diễn đạt',
      'lưu loát bằng lời nói và văn viết.',
    ],
  },
  7: {
    title: 'HSK 7 ~ 11.092 từ vựng (chung cấp 7–9)',
    desc: ['Sử dụng tiếng Trung trong học thuật', 'và công việc chuyên môn.'],
  },
  8: {
    title: 'HSK 8 ~ 11.092 từ vựng (chung cấp 7–9)',
    desc: ['Xử lý văn bản và thảo luận chuyên sâu', 'ở mức độ cao.'],
  },
  9: {
    title: 'HSK 9 ~ 11.092 từ vựng (chung cấp 7–9)',
    desc: ['Thành thạo gần như người bản ngữ', 'trong mọi lĩnh vực.'],
  },
};

const DEFAULT_LEVEL_INFO: { title: string; desc: [string, string] } = {
  title: 'HSK 3 ~ 2.245 từ vựng',
  desc: ['Có thể giao tiếp trong các tình huống', 'hàng ngày đơn giản.'],
};

export function OnboardingGoalForm({
  initialPurpose,
  initialBand,
  hasGoal,
  levels,
  notice,
}: {
  initialPurpose: LearningPurpose;
  initialBand: number;
  hasGoal: boolean;
  levels: LevelItem[];
  notice?: 'content_unavailable';
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Back/forward restores cached RSC props from the first render, so the URL
  // (kept in sync via replaceState) is the source of truth; props are fallback.
  const [urlSelection] = useState(() =>
    parseGoalPageSearchParams({
      purpose: searchParams.get('purpose') ?? undefined,
      band: searchParams.get('band') ?? undefined,
    }),
  );
  const [purpose, setPurpose] = useState<LearningPurpose>(
    urlSelection.purpose ?? initialPurpose,
  );
  const [band, setBand] = useState<number>(urlSelection.band ?? initialBand);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const updateSelection = (newPurpose: LearningPurpose, newBand: number) => {
    // Re-clicking the current choice is not a change; keep the notice.
    if (newPurpose === purpose && newBand === band) return;
    setPurpose(newPurpose);
    setBand(newBand);
    setNoticeDismissed(true);
    window.history.replaceState(
      null,
      '',
      `?purpose=${newPurpose}&band=${newBand}`,
    );
  };

  const handlePurposeChange = (newPurpose: LearningPurpose) => {
    updateSelection(newPurpose, band);
  };

  const handleBandChange = (newBand: number) => {
    updateSelection(purpose, newBand);
  };

  const purposeGroup = useRadioGroup({
    items: PURPOSE_IDS,
    onChange: handlePurposeChange,
  });

  const bandGroup = useRadioGroup({
    items: BANDS,
    onChange: handleBandChange,
  });

  const level = resolveLevelForBand(levels, band);
  const isLevelAvailable = level !== null;

  const handleContinue = () => {
    if (!isLevelAvailable) return;
    router.push(`/onboarding/plan?purpose=${purpose}&band=${band}`);
  };

  const levelInfo = LEVELS_INFO[band] ?? DEFAULT_LEVEL_INFO;

  return (
    <main className="app ob">
      <div className="ob__top">
        {hasGoal ? (
          <Link className="icon-btn" href="/learn" aria-label="Quay lại">
            <svg className="icon" aria-hidden="true">
              <use href="#i-arrow-left" />
            </svg>
          </Link>
        ) : (
          <span className="icon-btn" aria-hidden="true" />
        )}
        <div className="ob__dots" aria-hidden="true">
          <i className="is-on" />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <p className="ob__step">
          <span aria-hidden="true">1/4</span>
          <span className="sr-only">Bước 1 trên 4</span>
        </p>
      </div>

      <h1 className="ob__title">Mục tiêu học tập của bạn là gì?</h1>
      <p className="ob__sub">
        Chọn mục tiêu phù hợp để chúng tôi
        <br />
        đề xuất lộ trình tốt nhất
      </p>

      {notice === 'content_unavailable' && !noticeDismissed && (
        <div className="alert alert--error" role="alert">
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-alert-triangle" />
          </svg>
          <span>{ONBOARDING_ERROR_MESSAGES.goalContentUnavailableNotice}</span>
        </div>
      )}

      <div
        className="goal-grid"
        role="radiogroup"
        aria-label="Mục tiêu học tập"
      >
        {PURPOSES.map((p, index) => {
          const isSelected = purpose === p.id;
          return (
            <button
              key={p.id}
              className="goal"
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => handlePurposeChange(p.id)}
              onKeyDown={(e) => purposeGroup.handleKeyDown(e, index)}
            >
              <svg className="goal__check" aria-hidden="true">
                <use href="#i-check-circle" />
              </svg>
              <img src={p.img} alt="" width={78} height={76} />
              {p.label}
            </button>
          );
        })}
      </div>

      <h2 className="ob__h2 ob__section">Bạn muốn đạt trình độ HSK nào?</h2>
      <p className="ob__sub ob__sub--tight">Chọn cấp độ mục tiêu</p>
      <div
        className="levels"
        role="radiogroup"
        aria-label="Cấp độ HSK mục tiêu"
        id="levels"
      >
        {BANDS.map((b, index) => {
          const isSelected = band === b;
          return (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => handleBandChange(b)}
              onKeyDown={(e) => bandGroup.handleKeyDown(e, index)}
            >
              {b}
            </button>
          );
        })}
      </div>

      <div
        className={isLevelAvailable ? 'level-info' : 'alert alert--error'}
        aria-live="polite"
      >
        {isLevelAvailable ? (
          <>
            <svg className="icon" aria-hidden="true">
              <use href="#i-star-fill" />
            </svg>
            <div>
              <strong id="level-title">{levelInfo.title}</strong>
              <p id="level-desc">
                {levelInfo.desc[0]}
                <br />
                {levelInfo.desc[1]}
              </p>
            </div>
          </>
        ) : (
          <span id={LEVEL_ALERT_ID}>
            {ONBOARDING_ERROR_MESSAGES.levelUnavailableAlert(band)}
          </span>
        )}
      </div>

      <div className="ob__footer">
        <button
          className="btn btn--primary btn--block"
          type="button"
          aria-disabled={!isLevelAvailable ? 'true' : undefined}
          aria-describedby={!isLevelAvailable ? LEVEL_ALERT_ID : undefined}
          onClick={handleContinue}
        >
          Tiếp tục
        </button>
      </div>
    </main>
  );
}
