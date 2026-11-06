import Link from 'next/link';

import type { QuestionBankItem } from './question-query';

/**
 * Cột trái "Ngân hàng" (TL-89, Q113): mỗi mục là một link lọc kèm số đếm từ
 * `GET /questions/counts`. ≤900px CSS chuyển thành hàng link cuộn ngang.
 */
export function QuestionBankSidebar({ items }: { items: QuestionBankItem[] }) {
  return (
    <nav className="qn-bank" aria-label="Ngân hàng câu hỏi">
      <h2 className="qn-bank__title">Ngân hàng</h2>
      <ul className="qn-bank__list">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              className="qn-bank__item"
              href={item.href}
              aria-current={item.active ? 'true' : undefined}
            >
              <span className="qn-bank__label">{item.label}</span>
              <span className="qn-bank__count">{item.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
