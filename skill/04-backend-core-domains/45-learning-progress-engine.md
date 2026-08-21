---
name: learning-progress-engine
description: "Thiết kế progress projection và learning event cho HSK. Sử dụng khi ghi hoạt động, tính tiến độ lesson/topic/level, resume hoặc analytics học tập."
---

# Learning Progress Engine

1. LearningEvent immutable/idempotent là fact; Progress/UserTopicProgress là projection có thể rebuild.
2. Chốt event shape, ownership và location coherence lesson/topic/exercise; FK/history dùng RESTRICT.
3. Mutation lock theo canonical User → content → projection; retry cùng key trả fact cũ.
4. Công thức progress/versioned rule rõ, bounded 0–100, completion monotonic nếu nghiệp vụ yêu cầu.
5. Rebuild/reconcile job idempotent; event ordering và late/duplicate behavior được định nghĩa.
6. Public learning content phải visible; history đọc snapshot khi current content archived.
7. Test race, duplicate, out-of-order, archive, replay và projection drift.

**Gate:** không double count/lost update, resume deterministic, metrics event lag/reconcile failure và privacy retention có runbook.
