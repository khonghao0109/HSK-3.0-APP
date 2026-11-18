/**
 * Câu chọn tranh dùng ảnh ghép có nhãn A–F, nên nội dung lựa chọn chỉ là
 * chính chữ cái đó. Khi nội dung trùng nhãn, giao diện chỉ hiện nhãn một lần
 * thay vì "A A".
 */
export function isLetterOnlyOption(text: string, letter: string): boolean {
  return text.trim().toUpperCase() === letter.toUpperCase();
}
