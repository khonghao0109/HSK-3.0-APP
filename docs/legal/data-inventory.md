# Kiểm kê dữ liệu cá nhân — Hán Lộ (bản nháp M2.1f, 02/11/2026)

Tài liệu nội bộ, dùng làm căn cứ cho `terms-v1.0.md` và `privacy-v1.0.md`. Đây **không phải**
tư vấn pháp lý và không phải văn bản công bố cho người dùng — vì vậy tài liệu này **không có**
header "Phiên bản 1.0" và **không có** khối "Ghi chú cho người duyệt" như hai văn bản kia; mã
quyết định (Q…) và mã module (M…) được phép dùng ở đây, nhưng **không** được xuất hiện trong
thân `terms-v1.0.md`/`privacy-v1.0.md`.

- **Cách thu thập:** chỉ đọc mã nguồn và schema tại baseline `31ade07` (nhánh `macdev`), không
  chạy app, không kết nối DB, không đọc file `.env*`; HEAD lúc chạy gate là `60496d6` (một commit
  của session song song, không đụng `docs/legal/**` — `git diff --name-only 31ade07..HEAD`). Mọi
  dòng trong cột "Bằng chứng" là `đường/dẫn/tới/file:dòng` của chính repo này.
- **Phạm vi:** dữ liệu mà backend/frontend hiện tại thực sự ghi, đọc hoặc gửi ra ngoài.
  Tính năng chưa có mã nguồn được liệt kê riêng ở mục 7, không suy diễn là "đã có".
- **Quy ước:** `[CẦN PO]` = quyết định của Product Owner; `[CẦN PO/LEGAL]` = quyết định pháp lý
  hoặc vận hành mà mã nguồn không trả lời được. Không tự điền tên pháp nhân, địa chỉ, email
  liên hệ, nhà cung cấp production hay luật áp dụng.

## 1. Bảng kiểm kê chính

Cột "Giữ bao lâu" chỉ ghi điều mã nguồn chứng minh được; chỗ chưa có cơ chế xoá thì ghi rõ
"chưa có job xoá" thay vì suy đoán.

### 1.1. Tài khoản và xác thực

| Dữ liệu | Trường / model | Mục đích | Nơi lưu | Giữ bao lâu | Ai truy cập | Bên thứ ba | Bằng chứng |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Email tài khoản | `User.email` (unique) | Định danh đăng nhập, liên hệ giao dịch (xác thực email, đặt lại mật khẩu, thông báo xoá tài khoản) | PostgreSQL | Tới khi xoá tài khoản; khi ẩn danh thay bằng `deleted+<id>@anonymized.invalid` | Chủ tài khoản qua API; admin qua `/admin/users` (email, tên, vai trò, trạng thái, `lastLoginAt`) | Không (chỉ dùng nội bộ) | `backend/prisma/schema.prisma:219`; chuẩn hoá `trim().toLowerCase()` tại `backend/src/modules/auth/auth.service.ts:312-313`; ẩn danh `backend/src/modules/user/jobs/anonymize-account.job.ts:98-103`; admin đọc `backend/src/modules/admin-users/admin-users.service.ts:26-34` |
| Mật khẩu | `User.password` | Xác thực đăng nhập | PostgreSQL | Tới khi xoá tài khoản; khi ẩn danh thay bằng hash ngẫu nhiên không đăng nhập được | Không ai đọc được bản rõ; backend chỉ verify | Không | `backend/prisma/schema.prisma:220`; băm Argon2id + pepper `backend/src/modules/auth/utils/password-hasher.ts:9-10,22-27`; thay hash khi ẩn danh `backend/src/modules/user/jobs/anonymize-account.job.ts:98-103` |
| Tên hiển thị | `User.name`, `UserProfile.displayName` | Hiển thị trong app, lời chào | PostgreSQL | Tới khi xoá tài khoản; khi ẩn danh đặt `NULL` | Chủ tài khoản; admin | Không | `backend/prisma/schema.prisma:221,297`; `backend/src/modules/user/jobs/anonymize-account.job.ts:98-118` |
| Vai trò, trạng thái, khoá đăng nhập | `User.role`, `status`, `failedLoginAttempts`, `lockUntil`, `emailVerifiedAt`, `lastLoginAt`, `deletedAt` | Phân quyền, chống dò mật khẩu, trạng thái vòng đời tài khoản | PostgreSQL | `lastLoginAt`, `failedLoginAttempts`, `lockUntil` cập nhật liên tục; toàn bộ giữ tới khi xoá tài khoản | Chủ tài khoản (một phần), admin | Không | `backend/prisma/schema.prisma:222-230`; enum `AccountStatus` tại `:15-20`; cập nhật `lastLoginAt` khi đăng nhập `backend/src/modules/auth/auth.service.ts:220-229` |
| Phiên đăng nhập | `UserSession.tokenHash` (SHA-256 của refresh token), `expiresAt`, `createdAt`, `lastSeenAt`, `revokedAt`, `revocationReason` | Duy trì đăng nhập, thu hồi phiên | PostgreSQL | Hết hạn mặc định sau 30 ngày (`AUTH_REFRESH_TOKEN_TTL_DAYS`, tối đa 90); job xoá dòng đã hết hạn **quá 30 ngày** (tối đa 90 + 30 = 120 ngày kể từ lần cấp nếu cấu hình 90); xoá ngay khi xoá tài khoản | Backend xác thực; admin gián tiếp qua audit (không xem token) | Không | `backend/prisma/schema.prisma:307-324`; chỉ lưu hash: `backend/src/modules/auth/auth.service.ts:498-539` (INSERT chỉ có `userId`, `tokenHash`, `expiresAt`, `createdAt`, `lastSeenAt` tại `:517-533`); TTL `backend/src/config/jwt.config.ts:19`, `auth.service.ts:486-496`; xoá theo lịch `backend/src/modules/auth/jobs/purge-expired-sessions.job.ts:57-65` (INTERVAL '30 days' ở `:61`) |
| `UserSession.deviceId`, `userAgent`, `ipAddress` | Cột có trong schema | (Dự kiến) thông tin thiết bị cho phiên | PostgreSQL | — | — | — | **Không có mã nào ghi 3 cột này.** Kiểm tra: INSERT duy nhất `backend/src/modules/auth/auth.service.ts:517-533` không có 3 cột; `grep -rn "ipAddress" backend/src` chỉ thấy ở job export và DTO admin. Cột tồn tại ở `backend/prisma/schema.prisma:311-313` nhưng hiện luôn `NULL` |
| Token đặt lại mật khẩu | `PasswordResetToken.tokenHash`, `expiresAt`, `usedAt` | Cho phép đặt lại mật khẩu một lần | PostgreSQL | Token sống 30 phút; dòng hash **chưa có job xoá định kỳ** — nằm tới khi xoá tài khoản/ẩn danh (hash không dùng lại được) | Backend | Không | `backend/prisma/schema.prisma:326-337`; tạo token `backend/src/modules/auth/jobs/send-password-reset.job.ts:80-95` (`INTERVAL '30 minutes'`); dùng/claim `backend/src/modules/auth/auth.service.ts:713-719`; xoá khi xoá tài khoản `backend/src/modules/user/user.service.ts:272-282` |
| Token xác thực email | `EmailVerificationToken.tokenHash`, `expiresAt`, `usedAt` | Xác thực email một lần | PostgreSQL | Token sống 24 giờ; dòng hash chưa có job xoá định kỳ (giữ tới khi xoá tài khoản) | Backend | Không | `backend/prisma/schema.prisma:339-350`; `backend/src/modules/auth/jobs/send-email-verification.job.ts:87-104` (`INTERVAL '24 hours'`) |
| Hồ sơ | `UserProfile.locale` (`vi-VN`), `timezone` (`Asia/Ho_Chi_Minh`), `avatarUrl` | Định dạng ngôn ngữ/thời gian; ảnh đại diện | PostgreSQL | Giữ tới khi xoá tài khoản; khi ẩn danh **giữ** `locale`/`timezone`, xoá `displayName`/`avatarUrl` | Chủ tài khoản; giao diện admin không có màn hình xem (quyền truy cập DB: `[CẦN PO]`) | Không | `backend/prisma/schema.prisma:294-305`; cập nhật qua `PATCH /users/me/profile` `backend/src/modules/user/user.service.ts:91-148`; `avatarUrl` chưa có API ghi (UI ghi chú "no avatar API yet": `frontend/src/app/(learner)/learn/profile/page.tsx:11-45`) |

### 1.2. Mục tiêu, kế hoạch và tiến độ học

| Dữ liệu | Trường / model | Mục đích | Nơi lưu | Giữ bao lâu | Ai truy cập | Bên thứ ba | Bằng chứng |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mục tiêu học | `UserGoal`: `targetLevelId`, `targetBand`, `dailyMinutes`, `learningPurpose`, `reminderEnabled`, `reminderTime`, `startDate`, `isActive` | Cá nhân hoá lộ trình, nhắc học (nhắc học **chưa gửi** — xem mục 7) | PostgreSQL | Tới khi xoá tài khoản; ẩn danh **không xoá** (giữ theo user id giả danh) | Chủ tài khoản; giao diện admin không có màn hình xem (quyền truy cập DB: `[CẦN PO]`) | Không | `backend/prisma/schema.prisma:352-371`; DTO `backend/src/modules/onboarding/dto/create-goal.dto.ts:32-46` |
| Bài kiểm tra đầu vào | `PlacementAttempt`: `score`, `detailSnapshot` (JSON), `recommendedLevelId`, `recommendedBand`, thời điểm | Xếp cấp gợi ý, sinh kế hoạch — **model có, CHƯA có API ghi** (xem mục 7) | PostgreSQL (chưa có dữ liệu thật) | Nếu có dữ liệu: giữ tới khi xoá tài khoản; ẩn danh không xoá | Chưa có API cho người dùng; chỉ đọc để đếm trạng thái (`backend/src/modules/onboarding/onboarding.service.ts:129`) | Không | `backend/prisma/schema.prisma:373-393`; không có writer (`grep -rn "placementAttempt.create" backend/src` → rỗng) |
| Kế hoạch học | `LearningPlan`, `LearningPlanItem`: cấp mục tiêu, band, ngày bắt đầu/kết thúc, bài, lịch, trạng thái | Lộ trình học cá nhân | PostgreSQL | Giữ tới khi xoá tài khoản; ẩn danh **không xoá** | Chủ tài khoản; chỉ số tổng hợp nội bộ (mục 1.6) | Không | `backend/prisma/schema.prisma:395-436` |
| Tiến độ bài/chủ đề | `Progress`, `UserTopicProgress`: trạng thái, điểm, %, thời gian học, hoạt động gần nhất | Hiển thị tiến độ, mở khoá bài | PostgreSQL | Giữ tới khi xoá tài khoản; ẩn danh **không xoá** | Chủ tài khoản; chỉ số tổng hợp nội bộ | Không | `backend/prisma/schema.prisma:1070-1117`; cập nhật qua activity API `backend/src/modules/learning/activity/lesson-activity.controller.ts:46-143` |
| Bài tập đã làm | `LessonExerciseAttempt`: `answer` (JSON), `contentSnapshot`, `isCorrect`, `score`, `durationSeconds`, `submittedAt` | Chấm điểm, xem lại, lịch sử học | PostgreSQL | Immutable fact, **không hard-delete** (ADR-001); ẩn danh giữ nguyên | Chủ tài khoản; giao diện admin không có màn hình xem nội dung (quyền truy cập DB: `[CẦN PO]`) | Không | `backend/prisma/schema.prisma:1042-1068`; ghi qua `backend/src/modules/learning/activity/lesson-activity.service.ts:332-391` |
| Sự kiện học | `LearningEvent`: `type`, `lessonId`/`topicId`/`exerciseId`/`attemptId`, `metadata` (điểm, thời lượng, số lần), `occurredAt` | Vận hành tiến độ, mở khoá, chỉ số sản phẩm tổng hợp | PostgreSQL | Append-only, **không hard-delete** (ADR-001); ẩn danh giữ nguyên | Chủ tài khoản thấy hệ quả; nội bộ đọc để tính chỉ số | Không | `backend/prisma/schema.prisma:1119-1148`; metadata không có IP/thiết bị `backend/src/modules/learning/activity/lesson-activity.service.ts:383-391` |
| Từ đã lưu | `UserWord`, `UserWordProgress` | Sổ từ cá nhân | PostgreSQL | Tới khi xoá tài khoản; ẩn danh **không xoá** | Chủ tài khoản | Không | `backend/prisma/schema.prisma:1150-1178`; API `backend/src/modules/dictionary/dictionary.controller.ts:63-99` |
| Ôn tập ngắt quãng (SRS) | `ReviewCard`, `ReviewSession`, `ReviewEvent` | Lịch ôn, lịch sử chấm — **model có, CHƯA có API ghi** (xem mục 7) | PostgreSQL (chưa có dữ liệu thật) | Nếu có dữ liệu: fact lịch sử, không hard-delete; ẩn danh giữ nguyên | Chưa có API; chỉ đọc trong export (`backend/src/modules/user/jobs/data-export.job.ts:53-54,62`) | Không | `backend/prisma/schema.prisma:1180-1249`; không có writer ngoài test fixture (`grep -rn "reviewCard.create" backend/src` → rỗng) |

### 1.3. Thi thử

| Dữ liệu | Trường / model | Mục đích | Nơi lưu | Giữ bao lâu | Ai truy cập | Bên thứ ba | Bằng chứng |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lượt thi | `ExamAttempt`: trạng thái, `startedAt`, `expiresAt`, `submittedAt`, `score`, `maxScore`, `scoringVersion`, `invalidatedReason` | Chạy đề thi thử, chấm điểm, chống thi lại đồng thời | PostgreSQL | Immutable, không hard-delete; ẩn danh giữ nguyên | Chủ tài khoản; giao diện admin không có màn hình xem bài làm (quyền truy cập DB: `[CẦN PO]`) | Không | `backend/prisma/schema.prisma:1584-1616`; API `backend/src/modules/exam/exam.controller.ts` (nhóm `/exam/attempts`) |
| Đề thi đã chốt tại thời điểm thi | `ExamAttemptSnapshot.payload` (JSON), `contentHash`, `testVersion` | Tái lập đề để chấm/giải thích | PostgreSQL | Immutable; là bản sao nội dung đề, không phải dữ liệu người học tạo | Chủ tài khoản (qua API review); nội bộ | Không | `backend/prisma/schema.prisma:1618-1628` |
| Câu trả lời | `ExamAnswer.answer` (JSON), `isFlagged`, `answeredAt`, `lastSavedAt`, `score`, `detailJson` | Lưu bài làm, chấm điểm | PostgreSQL | Immutable, không hard-delete; ẩn danh giữ nguyên | Chủ tài khoản; giao diện admin không có màn hình xem (quyền truy cập DB: `[CẦN PO]`) | Không | `backend/prisma/schema.prisma:1630-1653` |
| Nhật ký thao tác thi | `ExamAttemptEvent`: `type`, `metadata`, `occurredAt` | Chống mất dữ liệu, replay khi autosave, chống gian lận kỹ thuật | PostgreSQL | Immutable, không hard-delete | Nội bộ | Không | `backend/prisma/schema.prisma:1655-1668`; metadata chỉ có số đếm/`bodySha256`/`clientElapsedMs`, không có IP `backend/src/modules/exam/exam.service.ts:1182-1196,1612-1625` |
| Kết quả | `Result`, `ResultSkillScore`: điểm, `passed`, `awardedBand`, `detailJson`, điểm từng kỹ năng | Trả kết quả, lịch sử thi | PostgreSQL | Immutable, không hard-delete; ẩn danh giữ nguyên | Chủ tài khoản | Không | `backend/prisma/schema.prisma:1670-1704` |

### 1.4. Đồng ý (consent) và yêu cầu quyền riêng tư

| Dữ liệu | Trường / model | Mục đích | Nơi lưu | Giữ bao lâu | Ai truy cập | Bên thứ ba | Bằng chứng |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bản ghi đồng ý | `Consent`: `type` (`terms`/`privacy`/`analytics`/`marketing`), `consentVersion`, `policyVersion`, `grantedAt`, `revokedAt` | Chứng minh người dùng đã đồng ý văn bản nào, bản nào | PostgreSQL | Fact, giữ nguyên sau khi ẩn danh (ADR-001) | Chủ tài khoản (khi API có); admin không xem | Không | `backend/prisma/schema.prisma:438-453`; enum `ConsentType` `:129-134`; **lưu ý:** API consent (M1.7b2) **chưa có mã nguồn**, xem mục 7 |
| Bổ sung theo Q192/Q197 (kế hoạch, chưa có trong schema) | `Consent` chưa có cột hash văn bản và cột kênh đồng ý; chưa có bảng phiên bản văn bản pháp lý | Q192 chốt lưu `userId`, loại văn bản, version, **hash**, thời điểm, **kênh**, không lưu IP; Q197 chốt hash SHA-256 mỗi phiên bản văn bản lưu ở **bảng phiên bản văn bản pháp lý** (loại, version, sha256, ngày hiệu lực) | — | — | — | — | Schema hiện chỉ có `consentVersion`/`policyVersion` (`backend/prisma/schema.prisma:442-443`); phần bổ sung làm ở **M1.7b2** (PLAN M1.7b2) |
| Yêu cầu xuất dữ liệu | `DataExportJob`: `status`, `outputStorageKey`, `outputExpiresAt`, `startedAt`, `completedAt`, `errorCode` | Xuất dữ liệu theo yêu cầu | PostgreSQL; file JSON ở object storage private | File tải được **24 giờ**; file vật lý xoá sau **7 ngày**; dòng job ở lại (metadata) | Chủ tài khoản; backend | Object storage (xem mục 2) | `backend/prisma/schema.prisma:455-472`; giới hạn 1 yêu cầu/24h `backend/src/modules/user/data-export.service.ts:58-71`; khoá file `backend/src/modules/user/jobs/data-export.job.ts:1075`; TTL 24 giờ `:1094`; purge `backend/src/modules/user/jobs/purge-expired-exports.job.ts:69` |
| Yêu cầu xoá tài khoản | `AccountDeletionRequest`: `status`, `reason` (tự nguyện), `verifiedAt`, `scheduledAt`, `completedAt` | Tiếp nhận và hẹn giờ xoá | PostgreSQL | Giữ làm bản ghi yêu cầu; `reason` bị đặt `NULL` khi ẩn danh | Chủ tài khoản biết `scheduledAt`; nội bộ | Không | `backend/prisma/schema.prisma:474-492`; 7 ngày chờ `backend/src/modules/user/user.service.ts:249`; xoá lý do `backend/src/modules/user/jobs/anonymize-account.job.ts:137-143` |
| Nhật ký kiểm toán | `AuditLog`: `actorId`, `action`, `targetType`, `targetId`, `correlationId`, `beforeSummary`/`afterSummary` (JSON), `createdAt`; cột `ipAddress`, `userAgent` | Truy vết thao tác nhạy cảm (xoá tài khoản, khoá/mở, đổi vai trò, xuất media) | PostgreSQL | Append-only, giữ nguyên sau ẩn danh; **không có job xoá** | Admin (`/admin/audit-logs`) | Không | `backend/prisma/schema.prisma:1334-1352`; ghi audit `backend/src/modules/auth/auth.service.ts:211-218`, `backend/src/modules/user/jobs/anonymize-account.job.ts:145-152`, `backend/src/modules/admin-users/admin-users.service.ts:250-266`; **cột `ipAddress`/`userAgent` chưa được mã nào ghi** (`grep -rn "ipAddress" backend/src`) |

### 1.5. Hạ tầng kỹ thuật có thể chứa dữ liệu cá nhân

| Dữ liệu | Trường / model | Mục đích | Nơi lưu | Giữ bao lâu | Ai truy cập | Bên thứ ba | Bằng chứng |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bộ đếm giới hạn tần suất | `RateLimitCounter.key`, `points`, `expireAt` | Chống dò mật khẩu/brute-force, chống lạm dụng | PostgreSQL | Xoá mỗi 60 giây một lần theo `expireAt` (batch 1.000) | Nội bộ | Không | `backend/prisma/schema.prisma:636-645`; `backend/src/infrastructure/rate-limit/postgres-throttler.storage.ts:57-100,114-152` (dọn dẹp `RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000` tại `:17`) |
| Địa chỉ IP trong khoá đếm (dưới dạng băm) | `RateLimitCounter.key` | Khoá đếm cho khách chưa đăng nhập | PostgreSQL | Tối đa vài phút (cửa sổ 60 giây + chu kỳ dọn) | Nội bộ | Không | Guard trả tracker `ip:<IP>` hoặc `user:<id>` (`backend/src/common/guards/custom-throttler.guard.ts:41-50,96-104`); guard **không** override `generateKey`, `app.module.ts` không đặt `generateKey` (`grep -rn "generateKey" backend/src` rỗng), nên key là `generateKey` mặc định của `@nestjs/throttler`: SHA-256 của `"<Class>-<handler>-<tên throttler>-<tracker>"` (`backend/node_modules/@nestjs/throttler/dist/throttler.guard.js:148-151`, gọi tại `:115`); storage chỉ nhận key đã băm và ghi vào `RateLimitCounter.key` (`backend/src/infrastructure/rate-limit/postgres-throttler.storage.ts:57-75`), khớp comment schema (`backend/prisma/schema.prisma:636-638`). Với khách chưa đăng nhập, IP **chỉ tồn tại dưới dạng SHA-256 của chuỗi có tiền tố route + IP** — đây là **giả danh hoá, không phải ẩn danh** (không gian IPv4 brute-force được), sống tối đa vài phút |
| Khoá đếm theo email (đã băm) | `RateLimitCounter.key` = SHA-256 của `login:email:<email>` / `password-reset:email:<email>` | Giới hạn thử đăng nhập/đặt lại theo email | PostgreSQL | Như trên (xoá khi hết hạn; reset sau đăng nhập thành công) | Nội bộ | Không | `backend/src/modules/auth/auth.service.ts:248-256` (`login:email:`), `:669-681` (`password-reset:email:`): tự băm rồi gọi **trực tiếp** `rateLimitStorage.increment`, **không** đi qua `ThrottlerGuard`/`generateKey` → key chỉ **một lớp** SHA-256 của `login:email:<email>` hoặc `password-reset:email:<email>`; các bộ đếm của guard cho cùng route là key riêng, không phải băm hai lớp cùng một giá trị |
| Hạn mức upload media (admin) | `MediaUploadRateLimit.actorId`, `windowStartedAt`, `requestCount` | Giới hạn tần suất upload của biên tập viên | PostgreSQL | Cửa sổ đếm theo actor | Nội bộ | Không | `backend/prisma/schema.prisma:627-634` |
| Media do admin/biên tập viên tải lên | `Media.url`, `storageKey`, `originalFilename`, `checksum`, `uploadedById`; `MediaIngestion.actorId`, `originalFilename`, `checksum` | Nội dung khóa học (audio/ảnh), kiểm duyệt | Object storage private + PostgreSQL | Nội dung hệ thống, soft-delete `deletedAt` | Admin/biên tập viên; người học qua API cấp quyền | Object storage (xem mục 2) | `backend/prisma/schema.prisma:530-625`; khoá `media/<năm>/<tháng>/<uuid>.<ext>` `backend/src/modules/cms/media-ingestion/media-ingestion.policy.ts:56`; URL nội bộ `/api/v1/media/<id>/access` `backend/src/modules/cms/media-ingestion/media-ingestion.service.ts:1229` |
| File xuất dữ liệu | Object JSON tại khoá `privacy-exports/<userId>/<exportId>-<hex>.json` | Trả dữ liệu cho chủ tài khoản | Object storage private | Tối đa 7 ngày (xem 1.4) | Chủ tài khoản qua endpoint có xác thực | Object storage | `backend/src/modules/user/jobs/data-export.job.ts:1075` |
| Nội dung mail giao dịch | Địa chỉ người nhận, tiêu đề, nội dung (xác thực email / đặt lại mật khẩu / thông báo xoá tài khoản) | Gửi mail giao dịch | Dịch vụ mail + hàng đợi job (PostgreSQL) | Theo nhà cung cấp mail `[CẦN PO]` | Hệ thống; nhà cung cấp mail | Nhà cung cấp mail (mã chọn bằng biến `MAIL_PROVIDER`, xem mục 2) | `backend/src/infrastructure/mail/mailer.module.ts:20-35`; `backend/src/modules/auth/jobs/send-password-reset.job.ts:107-108`; `backend/src/modules/user/jobs/send-account-deletion-scheduled.job.ts:135-136` |
| Log máy chủ web (nginx) | Địa chỉ IP (`$remote_addr`), method, URI (không kèm query), status, thời gian, `request_id` | Vận hành, điều tra sự cố, chống lạm dụng route media | File log trên máy chủ | `[CẦN PO]` (chính sách log của hạ tầng) | Vận hành `[CẦN PO]` | Không | `ops/nginx/media-security-http.conf:2-5`; `ops/nginx/media-security.conf:12,21,29` |
| Log ứng dụng | Chỉ `requestId` + tên lỗi khi có lỗi không xử lý; không ghi email/mật khẩu/token/IP/user-agent | Chẩn đoán | stdout (ConsoleLogger) | `[CẦN PO]` | Vận hành | Không | `backend/src/main.ts:29`; `backend/src/common/filters/global-exception.filter.ts:52-56`; không tìm thấy log chứa email/user (`grep -rn "logger\\.(log\|warn\|error).*email" backend/src` → rỗng) |
| Hàng đợi job | Payload job chứa `userId`/`requestId`/`exportId` | Xử lý nền (mail, export, ẩn danh) | PostgreSQL (pg-boss) | Theo retention của job queue `[CẦN PO]` | Worker | Không | `backend/src/infrastructure/jobs/job-queue.port.ts:5-20`; `backend/src/worker.module.ts:11-40` |

### 1.6. Dùng nội bộ cho chỉ số sản phẩm

| Dữ liệu | Mục đích | Ai truy cập | Bên thứ ba | Bằng chứng |
| --- | --- | --- | --- | --- |
| `User.createdAt`, `role`, `LearningPlan`, `LearningEvent` dạng **tổng hợp** (đếm) | Tính activation, lesson completion P0 (M2.8) | Nội bộ, script chỉ đọc | Không có analytics bên thứ ba trong mã nguồn | Script `READ ONLY`, chỉ in JSON tổng hợp: `backend/scripts/analytics/p0-product-metrics.ts:3,61,69`; định nghĩa `docs/analytics/P0_PRODUCT_METRICS.md:5-9,29-36,50`; ADR-008 §10 `docs/adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md:155-162` |

## 2. Chuyển ra bên thứ ba / hạ tầng ngoài

Chỉ liệt kê thứ **mã nguồn** chứng minh. Nơi đặt server, region, nhà cung cấp production cụ thể
đều là `[CẦN PO]` vì repo không chứa cấu hình đó và session này không đọc `.env*`.

| Thành phần | Dữ liệu đi qua | Bằng chứng | Chưa xác định |
| --- | --- | --- | --- |
| Object storage S3 (private bucket) | File media nội dung; file JSON xuất dữ liệu của người dùng | Adapter `s3`: `backend/src/infrastructure/storage/s3-object-storage.adapter.ts:25-45`; bucket lấy từ config `media.bucket` `:36`; object storage port `backend/src/infrastructure/storage/object-storage.port.ts:43` | Nhà cung cấp/region/bucket production `[CẦN PO]` |
| Dịch vụ mail | Địa chỉ email người nhận + nội dung mail giao dịch | Chọn adapter theo `MAIL_PROVIDER`: `ses` (Amazon SES v2) hoặc `mailpit`/`memory` khi dev `backend/src/infrastructure/mail/mailer.module.ts:20-35`; `backend/src/infrastructure/mail/ses-mailer.adapter.ts:1` | Provider production, region, chính sách lưu log mail `[CẦN PO]` |
| PostgreSQL | Toàn bộ dữ liệu ở mục 1 | `backend/prisma/schema.prisma:4-7` | Nơi đặt DB, backup, mã hoá at-rest `[CẦN PO]` |
| nginx (edge) | IP, URI, status của request (log truy cập) | `ops/nginx/media-security-http.conf:2-5` | Nơi lưu log, thời gian giữ `[CẦN PO]` |

Không có: analytics bên thứ ba, quảng cáo, SDK bên thứ ba trong frontend (CSP chỉ `'self'`,
`connect-src 'self'` — `frontend/src/lib/security/content-security-policy.ts:24-36`), dịch vụ
chấm phát âm, dịch vụ AI, cổng thanh toán trong mã nguồn hiện tại.

## 3. Dữ liệu KHÔNG lưu (và bằng chứng)

- **Không lưu IP/user-agent trong bản ghi đồng ý:** model `Consent` không có cột IP
  (`backend/prisma/schema.prisma:438-453`). Lưu ý: IP vẫn xuất hiện tạm thời trong bộ đếm rate
  limit (mục 1.5) và trong log nginx (mục 1.5) — không phải trong bản ghi consent.
- **Không lưu token gốc:** chỉ `tokenHash` SHA-256 (`UserSession`, `PasswordResetToken`,
  `EmailVerificationToken` — `backend/prisma/schema.prisma:310,329,342`; băm tại
  `backend/src/modules/auth/auth.service.ts:507-509,629,709`).
- **Không lưu mật khẩu bản rõ:** chỉ hash Argon2id + pepper
  (`backend/src/modules/auth/utils/password-hasher.ts:1-30`).
- **Browser không giữ bearer token:** token nằm trong cookie `HttpOnly`, `SameSite=Lax`,
  `Secure` ở production (`frontend/src/lib/auth/session-cookie.ts:12-19,75,94`;
  ADR-003 `docs/adr/ADR-003-FRONTEND-FOUNDATION-ADMIN-SESSION-BFF.md:44-49`); không có
  `localStorage`/`sessionStorage` trong `frontend/src` (grep rỗng).
- **Không lưu nội dung câu trả lời trong event autosave:** chỉ số đếm + hash
  (`backend/src/modules/exam/exam.service.ts:1186-1194,1617-1624`).
- **Không lưu `reason` xoá tài khoản sau khi ẩn danh:** `reason = NULL`
  (`backend/src/modules/user/jobs/anonymize-account.job.ts:137-143`).

## 4. Vòng đời xoá tài khoản (theo mã hiện tại)

1. `POST /users/me/deletion-request` yêu cầu xác thực lại mật khẩu; sai mật khẩu trả `400`
   `INVALID_PASSWORD` (`backend/src/modules/user/user.service.ts:152-190`;
   `backend/src/modules/user/user.controller.ts:88-104`).
2. Trong transaction: tạo `AccountDeletionRequest` với `scheduledAt = now + 7 ngày`, chuyển
   `User.status = deletion_pending`, đặt `deletedAt`, thu hồi mọi `UserSession`, xoá token
   reset/xác thực chưa dùng (`backend/src/modules/user/user.service.ts:241-286`).
3. Trong 7 ngày, đăng nhập lại đúng mật khẩu sẽ huỷ yêu cầu; đăng nhập sau hạn bị chặn và
   không lộ trạng thái tài khoản (`backend/src/modules/auth/auth.service.ts:112-235`;
   ADR-001 `docs/adr/ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md:85-92`).
4. Worker `privacy.anonymize-account` sau hạn: đổi email thành
   `deleted+<id>@anonymized.invalid`, `name = NULL`, thay hash mật khẩu bằng giá trị ngẫu nhiên,
   `status = anonymized`; xoá `displayName`/`avatarUrl`; xoá sạch session/token; `reason = NULL`
   (`backend/src/modules/user/jobs/anonymize-account.job.ts:94-152`).
5. **Giữ lại** dưới `User.id` giả danh: bài tập, sự kiện học, tiến độ, SRS, bài thi, kết quả,
   consent, audit (ADR-001 `docs/adr/ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md:36-48`;
   danh sách model giữ nguyên trong export coverage `backend/src/modules/user/jobs/data-export.job.ts:36-64`).
   Hiện **chưa có job** purge `Progress`/`UserWord`/`ReviewCard`/`LearningPlan` sau ẩn danh —
   ADR-001 chỉ nói "có thể purge bằng privacy job riêng sau khi retention được duyệt"
   (`:33-34`). **Q201 (02/11/2026):** bản 1.0 **không purge** dữ liệu học sau ẩn danh; dữ liệu
   được giữ dưới định danh giả, không còn liên kết tới email/tên; văn bản privacy ghi rõ điều này.

## 5. Xuất dữ liệu (theo mã hiện tại)

- Chỉ chủ tài khoản `active`, tối đa 1 yêu cầu/24 giờ
  (`backend/src/modules/user/data-export.service.ts:37-71`).
- File JSON một file, ghi vào object storage private, tải được trong 24 giờ, xoá sau 7 ngày
  (`backend/src/modules/user/jobs/data-export.job.ts:1075,1094`;
  `backend/src/modules/user/jobs/purge-expired-exports.job.ts:69`).
- Snapshot đọc ở mức `RepeatableRead`; loại trừ `PasswordResetToken`,
  `EmailVerificationToken`, `UserSession.tokenHash`, media/CMS
  (`backend/src/modules/user/jobs/data-export.job.ts:36-158,1037`).
- Endpoint tải có xác thực, `Cache-Control: no-store`, đối soát checksum
  (`backend/src/modules/user/user.controller.ts:124-150`;
  `backend/src/modules/user/data-export.service.ts:183-185`).

## 6. Nơi lưu, thời gian giữ, người truy cập — tóm tắt theo nhóm

| Nhóm | Lưu ở đâu | Giữ bao lâu | Truy cập |
| --- | --- | --- | --- |
| Tài khoản/xác thực | PostgreSQL | Tới khi xoá + ẩn danh; session tối đa 120 ngày (cấu hình 90 + dọn 30) | Chủ tài khoản, admin (email/tên/trạng thái), backend |
| Học tập/thi | PostgreSQL | Vĩnh viễn dưới id giả danh sau ẩn danh (ADR-001) | Chủ tài khoản, backend |
| Consent | PostgreSQL | Fact, giữ nguyên | Chủ tài khoản (khi API có), backend |
| Yêu cầu/xuất dữ liệu | PostgreSQL + object storage | File 7 ngày; metadata job giữ lại | Chủ tài khoản, backend |
| Hạ tầng kỹ thuật | PostgreSQL, log nginx | Rate limit vài phút; log hạ tầng `[CẦN PO]` | Vận hành `[CẦN PO]` |

## 7. Tính năng CHƯA có mã nguồn (cập nhật ở bản sau)

Các mục dưới đây **không** được mô tả là đang hoạt động trong privacy/terms 1.0, trừ phần
"đã có trong kế hoạch và consent sẽ xin riêng khi ra mắt":

| Tính năng | Trạng thái mã nguồn | Bằng chứng | Ghi chú cho văn bản |
| --- | --- | --- | --- |
| Consent API + ô tick khi đăng ký (M1.7b2, Q188/Q190/Q192/Q193) | **Chưa có** | PLAN M1.7b2 (⬜); không có controller/module consent (`grep -rn "consent" backend/src --include=*.ts` chỉ thấy job export); UI đăng ký hiện dùng câu thụ động "Bạn đồng ý với…" `frontend/src/features/learner-auth/learner-auth-alternatives.tsx:77-82` | Văn bản 1.0 chỉ được publish **sau khi** M1.7b2 xong (M2.1f gắn M1.7b2 — PLAN M2.1f). Ghi chú duyệt phải nêu điều kiện này |
| Bài kiểm tra đầu vào (model `PlacementAttempt`) | Model + đọc để đếm, **không có API ghi** | `backend/prisma/schema.prisma:373-393`; `onboarding.service.ts:129` chỉ `count`; `grep -rn "placementAttempt.create" backend/src` rỗng | Không mô tả là dữ liệu đang thu thập |
| Ôn tập ngắt quãng (model `ReviewCard`/`ReviewSession`/`ReviewEvent`) | Model + đọc trong export, **không có API ghi/controller** | `backend/prisma/schema.prisma:1180-1249`; `data-export.job.ts:46-48`; `grep -rn "reviewCard.create" backend/src` rỗng (chỉ test fixture `backend/test/data-export.e2e-spec.ts:447`) | Không mô tả là dữ liệu đang thu thập |
| Analytics sản phẩm có consent (M2.8 + Q190) | Chưa có `ProductEvent`/consent analytics | ADR-008 §10 `docs/adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md:157-162`; chỉ số hiện tính từ dữ liệu học first-party `docs/analytics/P0_PRODUCT_METRICS.md:5-9` | Nêu rõ "chưa có; khi ra mắt sẽ xin consent riêng, mặc định tắt" |
| Thông báo/nhắc học + marketing (M5.8) | Chưa có | PLAN M5.8; `UserGoal.reminderEnabled/reminderTime` có lưu (`backend/prisma/schema.prisma:359-360`) nhưng không có job gửi thông báo nào trong `backend/src/worker.module.ts:11-40` | Nêu rõ "chưa gửi thông báo; khi ra mắt sẽ xin consent riêng" |
| Ghi âm phát âm (M7.2) | Chưa có API; chỉ có model | PLAN M7.2; model `PronunciationAttempt.audioId` `backend/prisma/schema.prisma:1282-1297`; không có controller pronunciation (`grep -rn "pronunciation" backend/src/modules --include=*.controller.ts` rỗng) | Nêu rõ "chưa ghi âm; khi ra mắt consent riêng, xoá bản ghi sau 30 ngày" |
| AI chat/RAG (M7.4) | Chưa có runtime | PLAN M7.4; `ai/` chỉ có `README.md`, `package.json`, `tsconfig.json` (không có mã chạy); backend không tham chiếu RAG | Không nhắc như tính năng hiện có |
| OAuth Google/Apple/Facebook (M2.1e) | Chưa có | PLAN M2.1e; không có mã OAuth trong backend | Không nhắc như tính năng hiện có |
| Thanh toán/gói trả phí | Chưa có | Không có mã thanh toán (`grep -rn "payment\|checkout\|vnpay\|momo" backend/src` chỉ khớp `Permissions-Policy` `backend/src/config/runtime-security.ts:11-18`) | Không nhắc |
| UI xuất dữ liệu / xoá tài khoản cho người học | Chưa có | API có (`backend/src/modules/user/user.controller.ts:88-150`) nhưng frontend chỉ có generated types, không có màn hình (`frontend/src/app/(learner)/learn/profile/page.tsx:14` "Minimal profile until module 04/06 ships") | **Q195:** người dùng gửi yêu cầu qua kênh liên hệ ở mục Liên hệ; app sẽ có nút ở bản sau |

## 8. Phát hiện bất thường từ mã nguồn (cần xử lý trước publish)

1. **`UserSession.ipAddress`/`userAgent` là cột chết.** Có trong schema và được job export
   đọc (`backend/src/modules/user/jobs/data-export.job.ts:342`) nhưng không có mã ghi → luôn
   `NULL`. Không được mô tả là "thu thập IP/thiết bị phiên".
2. **`AuditLog.ipAddress`/`userAgent` là cột chết.** DTO admin ghi chú các trường này không rời
   API (`backend/src/modules/admin-users/dto/admin-audit-log-response.dto.ts:19`), nhưng không
   có writer nào đặt giá trị.
3. **`Consent` chưa có hash văn bản và kênh đồng ý**; Q192 đã chốt **có**, bổ sung ở M1.7b2 cùng bảng phiên bản văn bản pháp lý (Q197).
4. **Bản ghi consent giữ nguyên sau ẩn danh** theo ADR-001 (`Consent` nằm trong danh sách fact
   giữ lại; export coverage `backend/src/modules/user/jobs/data-export.job.ts:44`) — quyết định
   đúng theo ADR nhưng văn bản privacy cần nói rõ.
5. **`reminderEnabled`/`reminderTime` được lưu nhưng tính năng nhắc học chưa chạy** — người dùng
   có thể đã bật trong onboarding mà không nhận được gì; văn bản không được hứa "chúng tôi gửi
   nhắc học".
6. **Ghi công CC-CEDICT chưa đủ theo Q181.** Chi tiết:
   - Trang chi tiết từ chỉ hiện "Nguồn:" + "Phiên bản:"
     (`frontend/src/features/learner-dictionary/word-detail.tsx:316-320`), chưa có dòng giấy phép
     CC BY-SA 4.0/liên kết; khối này lại nằm trong mục "Ví dụ" và **chỉ render khi từ có câu ví
     dụ** (`word-detail.tsx:308`).
   - Chưa có trang "Giới thiệu" riêng để đặt ghi công; "Giới thiệu" hiện chỉ là anchor trong
     landing.
   - **Chi phí sửa thấp:** API từ điển đã trả `license`/`attribution`
     (`backend/src/modules/dictionary/dto/dictionary-word-response.dto.ts:17-22`) nhưng contract
     frontend bỏ hai trường này (`frontend/src/features/learner-dictionary/dictionary-contract.ts:32`)
     → chỉ cần sửa contract + hiển thị, không đổi schema.
   - **Điều kiện publish** (Q196): frontend hiển thị ghi công đủ (tên nguồn + giấy phép
     CC BY-SA 4.0 + liên kết) ở chi tiết từ và trang Giới thiệu — làm trong task M1.1. Không còn
     là câu hỏi cho PO.

## 9. Câu hỏi phải chốt trước khi publish v1.0

| # | Câu hỏi | Loại |
| --- | --- | --- |
| 1 | Tên pháp nhân, địa chỉ, mã số thuế/đăng ký kinh doanh của đơn vị vận hành Hán Lộ | `[CẦN PO/LEGAL]` |
| 2 | Email/kênh liên hệ cho yêu cầu quyền riêng tư và khiếu nại; thời hạn phản hồi cam kết | `[CẦN PO/LEGAL]` |
| 3 | Luật áp dụng, cơ quan giải quyết tranh chấp, cơ chế khiếu nại | `[CẦN LEGAL]` |
| 4 | Căn cứ pháp lý cho từng mục đích xử lý (hợp đồng / đồng ý / lợi ích hợp pháp) — xác nhận chung | `[CẦN LEGAL]` |
| 5 | Nơi đặt server/DB, region object storage, provider mail production, xác nhận TLS/HTTPS tại edge | `[CẦN PO]` |
| 6 | Thời gian giữ log máy chủ web và chính sách **backup/DB snapshot** | `[CẦN PO]` |
| 7 | Chính sách truy cập cơ sở dữ liệu và nhật ký truy cập nội bộ | `[CẦN PO]` |
| 8 | Kênh và quy trình xử lý báo cáo vi phạm bản quyền (chỉ áp cho Điều khoản) | `[CẦN PO/LEGAL]` |
| 9 | Quy trình thông báo, thời hạn khiếu nại và hoàn trả khi chấm dứt quyền dùng (chỉ áp cho Điều khoản) | `[CẦN PO/LEGAL]` |
| 10 | Xác nhận Q181 (attribution CC-CEDICT), Q188 (ô tick đồng ý), Q191 (tuổi tối thiểu 16) | `[CẦN PO/LEGAL]` |

Ghi chú: Q195–Q202 đã chốt các mục tương ứng (kênh thực hiện quyền, điều kiện publish ghi công
CC-CEDICT, bảng phiên bản văn bản pháp lý + consent hash/kênh ở M1.7b2, gian lận thi, dưới 16
tuổi, căn cứ cho chỉ số tổng hợp, không purge dữ liệu học, phạm vi "Dịch vụ" là website). Q184
(provider TTS) vẫn mở — cập nhật inventory khi chọn provider.

## 10. Liên kết

- Điều khoản sử dụng bản nháp: `docs/legal/terms-v1.0.md`
- Chính sách bảo mật bản nháp: `docs/legal/privacy-v1.0.md`
- Quyết định nền: ADR-001 (retention/xoá tài khoản), ADR-003 (phiên/BFF), ADR-008 §10
  (analytics), `docs/PLAN.md` mục quyết định 02/11/2026 (Q180–Q193).
