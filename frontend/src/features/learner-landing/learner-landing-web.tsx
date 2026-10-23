import Link from 'next/link';

import { LandingIcon } from './learner-landing-icons';
import {
  LANDING_FAQ,
  LANDING_FEATURES,
  LANDING_HERO,
  LANDING_LEVELS,
  LANDING_SIGN_IN_HREF,
  LANDING_SIGN_UP_HREF,
  LANDING_SOON,
  LANDING_STEPS,
} from './learner-landing-content';

/**
 * Cây RIÊNG cho trang `/` từ 1024px (mẫu `docs/ui_reference/web/index.html`,
 * PO Q81/Q84): hero 2 cột, lộ trình HSK, tính năng, bốn bước và FAQ.
 *
 * Bọc trong `.lp-page.w-only` nên dưới 1024px nó không tạo box và không vào
 * cây trợ năng; cây mobile `.app.welcome` giữ nguyên từng pixel (K3a) và chỉ
 * bị `.m-only` ẩn từ 1024px. Đây là cây tĩnh (không `'use client'`): `<details>`
 * của FAQ là control gốc của trình duyệt, dùng được bằng bàn phím.
 */
export function LearnerLandingWeb() {
  return (
    <div className="lp-page w-only">
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="w-wrap lp-hero__grid">
          <div className="lp-hero__text">
            <p className="w-tag">{LANDING_HERO.tag}</p>
            <h1 className="lp-hero__title" id="hero-title">
              {LANDING_HERO.title}
            </h1>
            <p className="lp-hero__hanzi">
              <span lang="zh-Hans">{LANDING_HERO.hanzi}</span>
              <span className="lp-hero__pinyin">{LANDING_HERO.pinyin}</span>
            </p>
            <p className="lp-hero__lead">{LANDING_HERO.lead}</p>
            <div className="lp-hero__cta">
              <Link
                className="btn w-btn w-btn--primary w-btn--lg"
                href={LANDING_SIGN_UP_HREF}
              >
                Bắt đầu học
                <LandingIcon name="chevron-right" />
              </Link>
              <Link
                className="btn w-btn w-btn--lg btn--outline-navy"
                href={LANDING_SIGN_IN_HREF}
              >
                Đăng nhập
              </Link>
            </div>
          </div>
          <div className="lp-hero__art">
            <img
              src="/images/learner/welcome-illustration.png"
              alt=""
              width={310}
              height={492}
            />
          </div>
        </div>
      </section>

      <section
        className="w-wrap lp-sec"
        id="levels"
        aria-labelledby="levels-title"
      >
        <div className="lp-sec__head">
          <h2 className="w-h2 lp-sec__title" id="levels-title">
            Lộ trình HSK 3.0
          </h2>
          <p className="w-muted">
            Chín cấp theo chuẩn HSK 3.0 (GF0025-2021). Cấp 7–9 học chung một lộ
            trình. Số từ vựng là số tích luỹ tới hết cấp.
          </p>
        </div>
        <ol className="w-grid w-grid--4 lp-levels">
          {LANDING_LEVELS.map((level) => (
            <li
              key={level.code}
              className={
                level.wide
                  ? 'w-card lp-level lp-level--wide'
                  : 'w-card lp-level'
              }
            >
              <span className="lp-level__no">{level.code}</span>
              <b>{level.words}</b>
              <span className="w-muted">{level.stage}</span>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="lp-band"
        id="features"
        aria-labelledby="features-title"
      >
        <div className="w-wrap">
          <div className="lp-sec__head">
            <h2 className="w-h2 lp-sec__title" id="features-title">
              Tính năng
            </h2>
            <p className="w-muted">
              Những gì bạn dùng được ngay hôm nay, và những gì đang được phát
              triển.
            </p>
          </div>
          <ul className="w-grid w-grid--4 lp-features">
            {LANDING_FEATURES.map((feature) => (
              <li key={feature.title} className="w-card lp-feature">
                <span
                  className={`lp-feature__icon is-${feature.tone}`}
                  aria-hidden="true"
                >
                  <LandingIcon name={feature.icon} />
                </span>
                <h3 className="w-h3">{feature.title}</h3>
                <p className="w-muted">{feature.text}</p>
              </li>
            ))}
          </ul>
          <ul
            className="w-grid w-grid--4 lp-soon"
            aria-label="Tính năng sắp có"
          >
            {LANDING_SOON.map((item) => (
              <li key={item.title} className="lp-soon__item">
                <LandingIcon name={item.icon} />
                <b>{item.title}</b>
                <span className="w-tag w-tag--soon">Sắp có</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="w-wrap lp-sec" aria-labelledby="steps-title">
        <div className="lp-sec__head">
          <h2 className="w-h2 lp-sec__title" id="steps-title">
            Bắt đầu trong 4 bước
          </h2>
        </div>
        <ol className="w-grid w-grid--4 lp-steps">
          {LANDING_STEPS.map((step, index) => (
            <li key={step.title} className="lp-step">
              <span className="lp-step__no" aria-hidden="true">
                {index + 1}
              </span>
              <h3 className="w-h3">
                <span className="sr-only">Bước {index + 1}: </span>
                {step.title}
              </h3>
              <p className="w-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="lp-cta">
          <div>
            <h3 className="lp-cta__title">Sẵn sàng bắt đầu?</h3>
            <p>
              Học 15 phút mỗi ngày giúp bạn nhớ lâu hơn và tiến bộ bền vững.
            </p>
          </div>
          <Link
            className="btn w-btn w-btn--primary w-btn--lg"
            href={LANDING_SIGN_UP_HREF}
          >
            Bắt đầu học
            <LandingIcon name="chevron-right" />
          </Link>
        </div>
      </section>

      <section
        className="w-wrap lp-sec lp-faq"
        id="faq"
        aria-labelledby="faq-title"
      >
        <div className="lp-sec__head">
          <h2 className="w-h2 lp-sec__title" id="faq-title">
            Câu hỏi thường gặp
          </h2>
          <p className="w-muted">
            Chưa thấy câu trả lời bạn cần? Bắt đầu học thử, bài đầu tiên của mỗi
            cấp luôn mở.
          </p>
        </div>
        <div className="lp-faq__list">
          {LANDING_FAQ.map((item) => (
            <details key={item.question}>
              <summary>
                {item.question}
                <LandingIcon name="chevron-down" />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
