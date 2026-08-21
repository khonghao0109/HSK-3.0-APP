---
name: exam-engine
description: "Thiết kế exam attempt, autosave, snapshot, submit và scoring HSK đáng tin cậy. Sử dụng khi thêm question bank/test/attempt/result, timer hoặc phân tích kết quả."
---

# Exam Engine

1. Publish Test tạo immutable snapshot version câu hỏi/order/weight/answer rules; attempt luôn trỏ snapshot.
2. Start/answer/autosave/submit idempotent; attempt state machine và server timestamps enforce transition.
3. Timer dựa server deadline; client chỉ hiển thị; late submit, reconnect/resume và multi-device policy rõ.
4. Answer snapshot không lộ correctAnswer trước submit; scoring server-side, versioned, deterministic và audit.
5. Band/result đối chiếu level range; HSK7_9 chấp nhận band 7–9; ownership/FK/history RESTRICT.
6. Lock attempt/user theo order; submit atomically finalize answers/result/events, retry trả cùng result.
7. Test crash/retry, concurrent submit, timeout boundary, content archive, cheating/IDOR và score golden set.

**Gate:** no answer leak/lost autosave/double result, restore attempt deterministic, load capacity theo exam peak và incident runbook.
