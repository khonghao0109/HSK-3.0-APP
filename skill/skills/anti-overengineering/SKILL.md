---
name: anti-overengineering
description: "Giữ thay đổi phần mềm ở mức nhỏ nhất đủ đạt outcome và risk hiện tại. Sử dụng khi lập kế hoạch, thiết kế, refactor hoặc triển khai có nguy cơ tự mở rộng scope, thêm abstraction, dependency, infrastructure hay hardening chưa có bằng chứng; không dùng để bỏ qua security, data integrity, privacy hoặc production gate bắt buộc."
---

# Anti-Overengineering

## Nguyên tắc

Tối ưu cho **giải pháp nhỏ nhất đủ đúng**, không phải ít dòng code nhất. Mọi phần của thay đổi phải phục vụ yêu cầu hiện tại, một rủi ro có bằng chứng hoặc một quality gate bắt buộc.

Đây là guard hỗ trợ, phải dùng cùng skill chuyên môn liên quan. Nó kiểm soát phạm vi và complexity, không thay thế domain correctness hoặc tự đổi stack/outcome người dùng đã chốt.

## Scope contract

Trước khi đề xuất hoặc sửa code, chốt ngắn gọn:

- **Outcome:** hành vi/người dùng nào phải thay đổi.
- **Must-have:** acceptance criteria và NFR bắt buộc trong vòng này.
- **Non-goals:** việc hợp lý nhưng chưa được yêu cầu.
- **Evidence:** defect, metric, incident, contract hoặc risk hiện có.
- **Diff budget:** boundary/file/schema/dependency dự kiến phải chạm.

Nếu chưa đủ thông tin, chỉ hỏi khi câu trả lời làm thay đổi đáng kể outcome hoặc kiến trúc. Nếu không, chọn giả định nhỏ nhất có thể đảo ngược và công khai giả định đó.

Vẫn thực hiện preflight bắt buộc của repository, nhưng chỉ mở rộng việc đọc/audit sang boundary có thể ảnh hưởng quyết định hiện tại.

## Necessity gate

Với mỗi abstraction, dependency, service, queue, cache, event, feature flag, schema change, generic framework hoặc lớp indirection mới, phải trả lời được:

1. Nó map tới must-have hoặc rủi ro hiện tại nào?
2. Evidence nào cho thấy giải pháp đang có không đủ?
3. Lựa chọn đơn giản hơn nào đã được xét và vì sao không đạt?
4. Chi phí vận hành, test, migration, rollback và ownership mới là gì?

Không trả lời được thì không triển khai trong scope hiện tại; ghi vào deferred ideas cùng trigger cụ thể nếu vẫn hữu ích.

## Cách chọn giải pháp

1. Tái sử dụng convention, boundary và dependency hiện có khi chúng đáp ứng yêu cầu.
2. Ưu tiên vertical slice nhỏ, reversible và đo được trước platform/framework tổng quát.
3. Chỉ extract abstraction khi đã có nhiều use case thật, contract đã ổn định, hoặc duplication hiện tại tạo rủi ro correctness/security đáng kể.
4. Chỉ thêm distributed component hay boundary mới khi ownership, failure isolation, compliance hoặc tải đo được chứng minh nhu cầu.
5. Test theo hành vi/rủi ro bị thay đổi: regression quan trọng và failure path thực tế; không nhân ma trận giả định vô hạn.
6. Telemetry phải chứng minh outcome hoặc failure quan trọng; không instrument mọi method chỉ vì có thể.
7. Docs/ADR tỷ lệ thuận với độ khó đảo ngược. Quyết định local, dễ đảo ngược không cần ceremony cấp kiến trúc.

## Phân tầng phạm vi

- **NOW:** bắt buộc để đạt acceptance và risk gate hiện tại — triển khai.
- **JUSTIFIED HARDENING:** có threat model, incident, invariant hoặc NFR hiện tại chứng minh — triển khai cùng evidence.
- **LATER:** chỉ phục vụ khả năng tương lai hoặc scale chưa đo được — không triển khai; ghi trigger tái xét nếu đáng giữ.

Không biến LATER thành NOW bằng các lý do mơ hồ như “sau này có thể cần”, “cho production” hoặc “để generic hơn”.

## Không được biến thành under-engineering

Các biện pháp cần thiết cho authentication/authorization, secret, privacy, data integrity, concurrency, idempotency, timeout, bounded retry, migration safety, rollback, accessibility và observability của failure quan trọng **không phải over-engineering** khi chúng nằm trong threat model, invariant hoặc production baseline áp dụng.

Không dùng skill này để:

- bỏ validation/test hoặc che finding có scenario tái lập;
- hạ severity chỉ để giảm scope;
- trì hoãn data-loss, security/privacy hoặc immutable-history fix;
- tuyên bố MVP được miễn các guardrail tối thiểu;
- thay acceptance criteria của người dùng bằng sở thích kỹ thuật.

## Scope-growth rule

Khi implementation phát hiện việc ngoài diff budget:

1. Xác định nó là blocker thật, risk bắt buộc hay improvement độc lập.
2. Chỉ mở rộng ngay nếu thiếu nó khiến acceptance sai hoặc tạo P0/P1 hiện hữu.
3. Nếu độc lập, dừng ở evidence + trigger; không sửa theo kiểu “while we are here”.
4. Nếu mở rộng làm thay đổi product scope, data contract hoặc kiến trúc khó đảo ngược, báo người dùng trước khi tiếp tục.

## Stop rule

Dừng công việc khi:

- acceptance criteria đã GREEN;
- required risk/quality gates đã GREEN;
- không còn finding P0/P1 trong phạm vi có scenario hiện hữu;
- diff sạch, reviewable và không kéo theo thay đổi unrelated.

Không tiếp tục refactor, tổng quát hóa, thêm option hoặc mở rộng test matrix sau điểm dừng nếu không có requirement/evidence mới.

## Báo cáo cuối

Nêu rõ:

- outcome đã hoàn thành và evidence;
- phần đã làm vì bắt buộc hoặc được chứng minh;
- phần cố ý không làm và lý do;
- trigger nào sẽ khiến phần deferred trở nên cần thiết;
- scope/diff thực tế có lệch contract ban đầu hay không.
