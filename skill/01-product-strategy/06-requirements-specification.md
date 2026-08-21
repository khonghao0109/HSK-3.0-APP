---
name: requirements-specification
description: "Chuyển nhu cầu sản phẩm thành đặc tả chức năng, phi chức năng, dữ liệu, quyền và tiêu chí phát hành có thể kiểm thử. Sử dụng khi viết PRD/spec, chốt phạm vi module, thay đổi API/schema hoặc chuẩn bị handoff cho thiết kế và kỹ thuật."
---

# Requirements Specification

## Mục tiêu

Tạo đặc tả đủ rõ để product, design, engineering, content và QA cùng hiểu một hành vi và có thể xác nhận hoàn thành.

## Cấu trúc đặc tả

1. Bối cảnh, vấn đề, persona và outcome.
2. Phạm vi trong/ngoài phiên bản; ưu tiên P0/P1/P2.
3. Luồng chính, luồng thay thế và trạng thái lỗi.
4. Quy tắc nghiệp vụ, role/permission và lifecycle.
5. Dữ liệu đầu vào/đầu ra, ownership, retention và migration.
6. API/event/interface cùng idempotency và compatibility.
7. Yêu cầu phi chức năng: hiệu năng, bảo mật, accessibility, observability và reliability.
8. Analytics events, metric thành công và guardrail.
9. Acceptance criteria, dependency, rollout và rollback.
10. Câu hỏi mở, owner và ngày cần quyết định.

## Quy trình

1. Truy nguyên yêu cầu từ discovery evidence hoặc mục tiêu roadmap.
2. Chuẩn hóa thuật ngữ domain trước khi mô tả hành vi.
3. Viết requirement bằng ngôn ngữ quan sát được; tránh “nhanh”, “dễ dùng”, “thông minh” nếu không có ngưỡng.
4. Mô tả đầy đủ loading, empty, error, retry, offline, permission và destructive state khi liên quan.
5. Đối chiếu từng requirement với UI, API, schema, content và test cần có.
6. Đánh mã requirement ổn định để trace qua story, test case và release note.
7. Review chéo với các owner bị ảnh hưởng; khóa baseline cho release.

## Quy tắc đặc thù HSK

- Ghi rõ HSK version và cách biểu diễn level 1–9; không ngầm coi 7–9 là một cấp.
- Ghi rõ ngôn ngữ nghĩa, script simplified/traditional, Pinyin và nguồn/license.
- Với exam, quy định section, timer, autosave, resume, snapshot, scoring và timeout.
- Với SRS, quy định grade, due time, timezone và lịch sử review.
- Với AI, quy định citation, prompt/model version, quota, feedback và fallback.
- Với premium, kiểm tra entitlement phía server; không dựa vào cờ UI.

## Đầu ra bắt buộc

- Requirement specification có version và owner.
- Traceability matrix: requirement → design/API/schema/test/metric.
- Danh sách out-of-scope, dependency và quyết định mở.

## Quality gate

- Mỗi P0 có acceptance criteria và error path kiểm thử được.
- Không có UI capability thiếu owner/schema/API hoặc feature flag.
- Security, privacy, data lifecycle và accessibility được xem xét rõ ràng.
- Không trộn trạng thái hiện tại với mục tiêu tương lai.

## Điều kiện dừng hoặc chuyển cấp

Không khóa spec nếu quyết định HSK coverage, scoring, source license, role hoặc business entitlement còn mơ hồ và làm đổi data model hay user promise.
