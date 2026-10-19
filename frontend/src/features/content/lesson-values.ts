/**
 * Giá trị của form bài học (M5.1a) — module thuần: không Zod, không
 * 'use client', nên page server lẫn form client cùng import được (hàm trong
 * module 'use client' không thể gọi từ server).
 */
export type LessonFormValues = {
  title: string;
  description: string;
  orderIndex: number;
  slug: string;
};

/**
 * TL-15: prefill từ snapshot bản sửa mới nhất. Snapshot là JsonValue nên
 * kiểm từng trường thay vì tin ép kiểu; snapshot lạ → null để page fallback
 * về giá trị đang live.
 */
export function lessonPrefillFromSnapshot(
  snapshot: unknown,
): LessonFormValues | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const value = snapshot as Record<string, unknown>;
  if (
    typeof value.title !== 'string' ||
    typeof value.slug !== 'string' ||
    typeof value.orderIndex !== 'number'
  ) {
    return null;
  }
  return {
    title: value.title,
    description: typeof value.description === 'string' ? value.description : '',
    orderIndex: value.orderIndex,
    slug: value.slug,
  };
}
