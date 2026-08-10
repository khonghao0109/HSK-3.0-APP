# Quy trình 02 — UX/UI & Product Design

## 1. Mục tiêu

Chuyển requirement và product outcome thành trải nghiệm user/admin dễ hiểu, nhất quán, responsive, accessible và có đặc tả đủ để frontend/mobile triển khai đúng.

## 2. Phạm vi skill

Gồm 10 skill từ `16-information-architecture` đến `25-design-handoff` trong `skill/02-ux-ui-product-design/`.

## 3. Điều kiện đầu vào

- Product brief, persona, story map, priority và metric đã qua Gate G3/G4 của nhóm 1.
- Domain/content model, role/permission và API/schema constraint sơ bộ.
- Nội dung thật hoặc mẫu đại diện cho Hán tự, Pinyin, tiếng Việt, audio và exam.
- Danh sách nền tảng mục tiêu: desktop web, mobile web, PWA hoặc native mobile.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Information Architecture

1. Kiểm kê chức năng và content object cho user/admin.
2. Xây taxonomy, navigation, labeling và search/filter model.
3. Kiểm tra card sorting/tree testing với persona mục tiêu.
4. Map route/screen tới capability và permission.

**Gate U1:** Người dùng tìm được chức năng cốt lõi; navigation không phản ánh trực tiếp cấu trúc backend.

### Giai đoạn 2 — User flow và state model

1. Vẽ luồng end-to-end cho onboarding, lesson, dictionary, review, exam, profile và admin CMS.
2. Mô tả entry/exit, decision, system response và recovery.
3. Bao phủ loading, empty, partial, error, offline, expired session, unauthorized và destructive confirmation.
4. Đối chiếu flow với role, entitlement và data lifecycle.

**Gate U2:** Mỗi P0 có happy path, alternate path và recovery path.

### Giai đoạn 3 — Research và usability baseline

1. Viết research question, participant criteria và task scenario.
2. Chọn phương pháp interview, contextual inquiry, concept test hoặc usability test.
3. Thu thập consent và loại bỏ dữ liệu không cần thiết.
4. Tổng hợp issue theo severity, frequency và impact; không chỉ theo ý kiến chủ quan.

**Gate U3:** Insight có bằng chứng, sample/context và quyết định thiết kế đi kèm.

### Giai đoạn 4 — Wireframe và prototype

1. Dựng low-fidelity cho cấu trúc và luồng trước visual polish.
2. Dùng content thật để kiểm tra độ dài, Hanzi/Pinyin, audio, timer và bảng admin.
3. Tạo prototype tương tác cho task rủi ro cao.
4. Test, sửa và lưu rationale cho thay đổi lớn.

**Gate U4:** Task P0 đạt tiêu chí usability đã chốt, không còn blocker mức critical.

### Giai đoạn 5 — Design system và visual UI

1. Xác lập token màu, type, spacing, radius, elevation, motion và breakpoint.
2. Xây component/state matrix trước page composition.
3. Thiết kế typography hỗ trợ Hán tự, Pinyin, tiếng Việt và fallback font.
4. Giữ contrast, focus, target size và feedback trạng thái nhất quán.
5. Version component và ghi rõ deprecated/migration path.

**Gate U5:** Component dùng token, có đủ variant/state và không tạo pattern trùng lặp không cần thiết.

### Giai đoạn 6 — Responsive, mobile và accessibility

1. Chọn responsive behavior theo task, không chỉ thu nhỏ desktop.
2. Kiểm tra keyboard, screen reader, zoom, reduced motion, color contrast và touch target.
3. Thiết kế audio transcript/caption, error association và timer accommodation.
4. Xác định offline/sync/conflict state nếu nằm trong phạm vi.

**Gate U6:** P0 đáp ứng WCAG target đã chốt và hoạt động ở breakpoint/device mục tiêu.

### Giai đoạn 7 — Content design, localization và handoff

1. Chuẩn hóa microcopy, terminology, tone, date/time, score và validation message.
2. Tách string khỏi layout; dự phòng text expansion và pluralization.
3. Gắn screen/component với story, API, analytics và acceptance criteria.
4. Bàn giao spec kích thước, behavior, asset, token, state và prototype.
5. Tổ chức design QA trên implementation trước khi sign-off.

## 5. Artifact bắt buộc

- Sitemap/IA, route-permission matrix và user flow.
- Research plan, raw evidence, finding và decision log.
- Wireframe/prototype đã test.
- Design tokens, component inventory và accessibility annotations.
- Responsive spec, content/localization guide và handoff package.

## 6. Chỉ số kiểm soát

- Task success và time-on-task cho luồng P0.
- Số issue usability theo severity còn mở.
- Tỷ lệ screen dùng component/token chuẩn.
- Tỷ lệ state required đã thiết kế.
- Số lỗi accessibility critical/high trước handoff.

## 7. Definition of Done

Nhóm 2 hoàn tất khi mọi luồng P0 có prototype đã kiểm chứng, component/state/responsive/accessibility đủ, copy và content mapping rõ, handoff nối được với requirement/API/analytics, và frontend không phải tự suy đoán hành vi.

## 8. Bàn giao

Bàn giao cho Architecture/Frontend/Mobile cùng design link/version, asset manifest, interaction spec, state matrix, accessibility acceptance criteria và danh sách quyết định còn mở có owner/date.
