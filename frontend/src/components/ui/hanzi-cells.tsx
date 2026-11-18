/**
 * Lượt 8 (田字格): mỗi chữ Hán của `text` trong một ô vuông `.tzg-cell` riêng;
 * ký tự khác (Latin, khoảng trắng, dấu ·) để nguyên. Lưới chỉ được vẽ ở ba
 * vị trí chữ Hán lớn (learner-web.css), không nơi nào khác.
 *
 * Trợ năng: Chromium coi mỗi ô inline-grid là một khối riêng nên trình đọc
 * màn hình đọc tách từng chữ (sai âm với chữ đa âm, ví dụ 行 trong 银行). Vì
 * vậy cả từ được đọc một lần từ span `.sr-only`, còn hàng ô `aria-hidden`.
 */
const HAN = /\p{Script=Han}/u;

export function HanziCells({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="tzg-cells" aria-hidden="true">
        {/* Array.from tách theo code point: chữ ngoài BMP không bị vỡ đôi. */}
        {Array.from(text).map((char, i) =>
          HAN.test(char) ? (
            <span className="tzg-cell" key={i}>
              {char}
            </span>
          ) : (
            char
          ),
        )}
      </span>
    </>
  );
}
