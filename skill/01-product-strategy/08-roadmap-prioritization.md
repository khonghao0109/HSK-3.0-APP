---
name: roadmap-prioritization
description: "Ưu tiên outcome, capability và sequencing roadmap theo giá trị, bằng chứng, dependency, rủi ro và năng lực đội ngũ. Sử dụng khi lập quý/release, đánh đổi P0/P1/P2, xử lý scope creep hoặc cập nhật roadmap HSK System."
---

# Roadmap Prioritization

## Mục tiêu

Xây roadmap theo outcome và dependency thật, bảo vệ đường tới MVP có thể học–ôn–thi thay vì tích lũy danh sách tính năng.

## Quy trình

1. Chốt north-star outcome, KPI release và constraint thời gian/người/ngân sách.
2. Gom candidate theo problem/opportunity; loại duplicate và solution chưa có bằng chứng.
3. Chấm một khung nhất quán như RICE hoặc WSJF; ghi số liệu, nguồn và mức tin cậy.
4. Áp dụng strategic fit, compliance, security, data readiness và operational readiness như gate.
5. Vẽ dependency: data/content → CMS → API → UX → analytics → vận hành.
6. Tách must-have P0, experience P1 và differentiation/expansion P2.
7. Xếp theo lát cắt end-to-end có thể phát hành và đo, không theo layer kỹ thuật.
8. Dành capacity cho quality, migration, observability, content pipeline và debt.
9. Xác định exit criteria, kill criteria và decision date cho mỗi milestone.
10. Cập nhật roadmap khi bằng chứng thay đổi; lưu rationale thay vì chỉ đổi thứ tự.

## Quy tắc P0/P1/P2

- P0: thiếu thì web MVP không hoàn thành lời hứa học, ôn, thi hoặc không an toàn để vận hành.
- P1: tăng đáng kể hiệu quả học/vận hành sau khi core flow ổn định.
- P2: khác biệt hóa, monetization hoặc mở rộng nền tảng; không chặn MVP.

## Sequencing khuyến nghị cho HSK

1. Chốt HSK 1–9, nguồn/license, nghĩa Việt và content taxonomy.
2. CMS Lite/import/validation/publish.
3. Learning activity, progress và SRS.
4. Exam attempt/autosave/snapshot/scoring.
5. Web MVP nối end-to-end cùng analytics cơ bản.
6. Reader, pronunciation, media, notifications và admin analytics.
7. AI/RAG, handwriting/OCR, subscription, mobile offline và community.

## Đầu ra bắt buộc

- Prioritization scorecard có giả định và confidence.
- Roadmap theo outcome, milestone, dependency và exit criteria.
- Now/Next/Later view và danh sách intentionally deferred.
- Capacity/risk budget và trigger tái ưu tiên.

## Quality gate

- Mỗi item phải có outcome owner, metric và dependency.
- Không xếp P0 chỉ vì stakeholder yêu cầu gấp.
- Compliance, content/data readiness và migration không bị giấu trong “technical work”.
- Roadmap không cam kết ngày khi chưa có ước lượng và capacity đủ tin cậy.

## Điều kiện dừng hoặc chuyển cấp

Yêu cầu product owner quyết định khi hai mục có giá trị gần nhau nhưng đánh đổi chiến lược, pháp lý hoặc ngân sách vượt thẩm quyền nhóm kỹ thuật.
