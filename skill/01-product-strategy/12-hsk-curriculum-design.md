---
name: hsk-curriculum-design
description: "Thiết kế curriculum HSK 3.0 theo contract hiện hành HSK1–HSK6 và HSK7_9 với awarded/target band 7–9. Sử dụng khi xây taxonomy, lesson path, placement, blueprint bài thi hoặc kiểm định nội dung."
---

# HSK Curriculum Design

## Mục tiêu

Biến chuẩn HSK đã được xác minh thành chương trình học có progression, coverage và bằng chứng đánh giá nhất quán trong sản phẩm.

## Nguồn và nguyên tắc

- Dùng tài liệu chính thức hoặc nguồn được content owner phê duyệt; ghi version, ngày và license.
- Không tự suy diễn danh sách từ, điểm số hoặc format thi khi chuẩn chưa công bố rõ.
- Tách curriculum taxonomy khỏi UI navigation và database implementation.
- Thiết kế cho người Việt nhưng giữ metadata tiếng Trung/Anh khi cần đối chiếu.

## Quy trình

1. Chốt HSK framework/version; giữ `HSK7_9` là một level và biểu diễn kết quả/mục tiêu bằng band 7, 8 hoặc 9.
2. Xây competency map theo listening, reading, writing, speaking, vocabulary, grammar và Hanzi.
3. Viết measurable learning objective cho mỗi level/unit/lesson.
4. Xác định prerequisite và progression; tránh bước nhảy không có nội dung cầu nối.
5. Lập content blueprint: lesson, topic, story, activity, word, grammar point, media và assessment.
6. Map mỗi asset/activity tới objective, level, difficulty, source và version.
7. Thiết kế placement rule và remediation path; không chỉ dựa vào một tổng điểm.
8. Thiết kế assessment blueprint theo skill/objective/difficulty, cùng coverage threshold.
9. Rà soát cognitive load, độ dài phiên học, lặp lại và transfer sang ngữ cảnh thật.
10. Pilot với người học mục tiêu; dùng item analysis và feedback để điều chỉnh.

## Yêu cầu dữ liệu tối thiểu

- CurriculumVersion, HskLevel (`HSK1`–`HSK6`, `HSK7_9`), awarded/target band, Competency, LearningObjective và prerequisite.
- Content mapping theo objective/skill/topic/difficulty/version.
- Vocabulary/grammar provenance và review status.
- Assessment blueprint, question coverage và scoring version.
- Placement result gồm evidence và recommended start point.

## Đầu ra bắt buộc

- Curriculum map HSK 1–6 và HSK7_9/band 7–9 có version.
- Objective matrix và prerequisite graph.
- Lesson/assessment blueprint cùng coverage report.
- Content gap register và quy trình academic review.

## Quality gate

- Mỗi lesson/activity/exam item truy được về objective và source.
- HSK7_9 không bị tách thành ba `HskLevel`; việc tách chỉ được phép qua product decision, ADR và migration riêng.
- Coverage không chỉ đếm số lượng; phải xem skill, objective và difficulty.
- Mọi thay đổi curriculum có version, reviewer và migration impact.

## Điều kiện dừng hoặc chuyển cấp

Không publish claim “đúng chuẩn HSK” khi chưa có source/version được xác minh. Chuyển quyết định học thuật cho curriculum lead hoặc chuyên gia ngôn ngữ có thẩm quyền.
