---
name: user-flow-design
description: "Thiết kế luồng end-to-end, trạng thái và recovery cho user/admin HSK 3.0. Sử dụng khi xây onboarding, learning, review, exam, CMS, media, payment hoặc bất kỳ tác vụ nhiều bước nào."
---

# User Flow Design

## Quy trình

1. Chốt actor, trigger, job-to-be-done, precondition và success metric.
2. Map happy path từ entry đến outcome; mỗi bước chỉ có một primary action rõ ràng.
3. Bổ sung nhánh anonymous, forbidden, session expired, validation, conflict, timeout, offline, retry và abandon/resume.
4. Với thao tác ghi, xác định idempotency, autosave, confirmation, undo và trạng thái sau refresh/back.
5. Đối chiếu ảnh mẫu module; giữ vị trí navigation/action và thứ bậc nội dung.
6. Map bước → route → UI state → API → database fact/projection → analytics event.
7. Prototype luồng rủi ro cao; test keyboard, mobile, mạng chậm và dữ liệu dài.

## Invariant production

- Không có dead end; lỗi luôn nêu cách phục hồi an toàn.
- Không dựa vào client để bảo vệ quyền hoặc tính toàn vẹn.
- Submit/retry không tạo dữ liệu trùng; destructive action có xác nhận tương xứng.
- Session/auth redirect không loop, không làm lộ token và giữ canonical origin.
- Flow dài có progress, save/resume và chống mất dữ liệu.

## Đầu ra

Flow diagram, state table, API/error mapping, acceptance criteria và danh sách event đo funnel.
