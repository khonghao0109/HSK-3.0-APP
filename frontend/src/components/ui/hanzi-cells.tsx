/**
 * Lượt 8 (田字格): mỗi chữ Hán của `text` trong một ô vuông `.tzg-cell` riêng;
 * ký tự khác (Latin, khoảng trắng, dấu ·) để nguyên. Không chèn khoảng trắng
 * giữa các ô, nên textContent của phần tử cha vẫn là cả từ liền mạch. Lưới
 * chỉ được vẽ ở ba vị trí chữ Hán lớn (learner-web.css), không nơi nào khác.
 */
const HAN = /\p{Script=Han}/u;

export function HanziCells({ text }: { text: string }) {
  // Array.from tách theo code point: chữ ngoài BMP không bị vỡ đôi.
  return Array.from(text).map((char, i) =>
    HAN.test(char) ? (
      <span className="tzg-cell" key={i}>
        {char}
      </span>
    ) : (
      char
    ),
  );
}
