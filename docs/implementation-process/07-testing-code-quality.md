# Quy trình 07 — Testing & Code Quality

## 1. Mục tiêu

Xây chiến lược kiểm thử theo rủi ro, tự động hóa các contract/luồng quan trọng và thiết lập quality gate để lỗi được phát hiện sớm, tái hiện được và không tái phát.

## 2. Phạm vi skill

Gồm 9 skill từ `69-test-strategy` đến `77-bug-triage` trong `skill/07-testing-code-quality/`.

## 3. Điều kiện đầu vào

- Requirement/acceptance criteria, architecture/API contract và risk register.
- Môi trường test, fixture/seed, test account và data isolation.
- Browser/device/load/security target và release risk classification.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Test strategy theo rủi ro

1. Lập risk matrix theo probability, impact và detectability.
2. Map requirement/invariant tới test level: static, unit, integration, contract, e2e, performance, security, accessibility và manual exploratory.
3. Chọn test pyramid phù hợp; tránh dồn mọi hành vi vào e2e chậm.
4. Chốt environment, data, owner, cadence, evidence và exit criteria.

**Gate Q1:** Mọi P0/high risk có test owner, level và acceptance oracle rõ.

### Giai đoạn 2 — Unit và integration

1. Unit test rule/policy/state transition với input boundary và deterministic clock/random.
2. Integration test DB transaction, constraint, migration, queue/cache/storage/provider adapter.
3. Dùng database thật hoặc container cho hành vi phụ thuộc PostgreSQL/Prisma.
4. Cô lập test data; không phụ thuộc thứ tự chạy.

**Gate Q2:** Invariant và failure path quan trọng có test tái hiện được.

### Giai đoạn 3 — Contract và end-to-end

1. Contract test request/response/error/event giữa frontend-backend-AI/provider.
2. E2E test luồng user/admin quan trọng bằng API/UI theo mục tiêu.
3. Bao phủ authz, session expiry, autosave/resume/submit, retry và idempotency.
4. Quản lý fixture/version để tránh test brittle do content biến động.

### Giai đoạn 4 — Performance và reliability

1. Tạo workload từ usage model: read, search, exam submit, review queue và admin import.
2. Chạy baseline, load, stress, soak và recovery theo rủi ro.
3. Đo latency percentile, throughput, error, saturation và queue lag.
4. Test failover/retry/backpressure; xác nhận không tạo duplicate hoặc data loss.

**Gate Q3:** SLO workload P0 đạt trên dữ liệu/môi trường đại diện.

### Giai đoạn 5 — Security và accessibility

1. Test authentication, authorization, input, rate limit, secret, upload và dependency.
2. Kiểm tra OWASP/abuse case, tenant/owner isolation, prompt injection và data leakage.
3. Chạy automated accessibility scan nhưng luôn bổ sung keyboard/screen reader/manual.
4. Theo dõi remediation theo severity và residual risk.

**Gate Q4:** Không còn security/accessibility critical/high chưa được xử lý hoặc chấp thuận đúng thẩm quyền.

### Giai đoạn 6 — Manual QA và exploratory

1. Viết charter theo risk, persona, device, locale và network condition.
2. Kiểm tra nội dung Hán tự/Pinyin/Việt, audio, timer, timezone và destructive flow.
3. Thu evidence rõ: build, data, steps, expected/actual, video/log/request ID.
4. Tách lỗi sản phẩm, dữ liệu, môi trường và misunderstanding requirement.

### Giai đoạn 7 — Code review và bug triage

1. Review correctness, security, data, compatibility, observability và maintainability.
2. Ưu tiên diff nhỏ, có test/evidence; kiểm tra generated/migration/config riêng.
3. Triage bug theo severity, user impact, reproducibility và release risk.
4. Gán owner/SLA, duplicate/root cause và regression test trước khi đóng.

### Giai đoạn 8 — Release quality gate

1. Tổng hợp pass/fail/waiver, flaky tests, defect trend và coverage theo risk.
2. Chạy smoke trên artifact sẽ release, không build lại khác artifact.
3. Ghi go/no-go với owner và rollback trigger.
4. Sau release, theo dõi error/performance/support và đóng vòng regression.

## 5. Artifact bắt buộc

- Test strategy, requirement-risk-test traceability và environment matrix.
- Automated test suite, fixture/seed và execution report.
- Performance/security/accessibility/manual QA evidence.
- Review checklist, defect register, waiver và release quality sign-off.

## 6. Chỉ số kiểm soát

- Coverage theo critical requirement/invariant.
- Defect escape rate, reopen rate và mean time to resolution.
- Flaky test rate, suite duration và failure diagnosis time.
- P95/P99, error/saturation dưới workload mục tiêu.
- Critical/high security và accessibility backlog.

## 7. Definition of Done

Nhóm 7 hoàn tất khi test evidence chứng minh requirement/risk P0 được bao phủ, suite ổn định trong CI, lỗi high được xử lý hoặc waiver đúng thẩm quyền, artifact release qua smoke và regression test ngăn lỗi quan trọng tái diễn.
