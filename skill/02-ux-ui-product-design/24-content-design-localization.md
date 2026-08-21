---
name: content-design-localization
description: "Thiết kế microcopy, thuật ngữ và localization cho giao diện học tiếng Trung HSK. Sử dụng khi thêm/chỉnh label, instruction, error, empty state, notification, nội dung song ngữ hoặc chuẩn bị locale mới."
---

# Content Design & Localization

## Quy trình

1. Xác định audience, task và tone; viết từ phía người dùng bằng động từ cụ thể.
2. Duy trì glossary Hán tự, pinyin, tiếng Việt, thuật ngữ HSK và admin status; một khái niệm một tên.
3. Tách UI string khỏi code; dùng key ổn định, ICU/plural/date/number theo locale.
4. Không ghép câu bằng fragment; cho phép reordered grammar và text expansion 30–50%.
5. Error nêu điều xảy ra và recovery, không lộ stack/secret; destructive action nói rõ phạm vi.
6. Pinyin có tone/normalization nhất quán; Hanzi font/fallback và line breaking được kiểm tra.
7. Review bởi subject-matter/localization owner, pseudo-localize và test screenshot.

## Quality gate

- Không hardcode copy trùng, placeholder-only label hoặc thuật ngữ kỹ thuật không giải thích.
- Content bản quyền có provenance/license; AI-generated content có review policy.
- Layout không vỡ với tiếng Việt dài, Hanzi, pinyin và accessibility text scaling.
- Phiên bản glossary, translation status và fallback locale được theo dõi.
