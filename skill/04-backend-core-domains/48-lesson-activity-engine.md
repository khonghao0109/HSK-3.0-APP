---
name: lesson-activity-engine
description: "Triển khai lesson exercise submit, scoring, attempt snapshot và progress atomically. Sử dụng khi thêm exercise type, submit/retry, completion hoặc activity concurrency."
---

# Lesson Activity Engine

1. Shared authoring validator/scorer định nghĩa canonical content/answer; không tạo contract lệch giữa CMS/import/runtime.
2. Submit lock User → Lesson → Topic → Exercise → projection; verify public/parent/media visibility trong transaction.
3. Attempt submitted, contentSnapshot và LearningEvent immutable; snapshot không chứa answer/secret/storage metadata.
4. Idempotency bind user+operation+payload; exact retry trả attempt/event cũ ngay cả khi content sau đó archive.
5. Score bounded/versioned; server không tin isCorrect/score client; duration/input giới hạn.
6. Completion update cùng transaction hoặc event/outbox nhất quán; history không đọc live exercise.
7. Test từng type, wrong shape, publish/archive vs submit, same actor lock order, timeout/deadlock và replay.

**Gate:** atomic attempt/event/progress, no history mutation/leak, seven-state visibility và concurrency harness fail-closed.
