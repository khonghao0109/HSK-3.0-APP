# Phân cấp chức năng — HSK System

> Cập nhật runtime/schema: 11/08/2026. Hệ thống dùng 7 nhóm curriculum: `HSK1`…`HSK6`, `HSK7_9` (band 7–9). “Schema sẵn sàng” không đồng nghĩa API/UI hoặc release gate đã hoàn tất.

Tài liệu này mô tả chức năng theo vai trò **User** và **Admin**, đồng thời xác định mức ưu tiên triển khai.

> `P0` — bắt buộc để ra mắt Web MVP có thể học, ôn và thi.
>
> `P1` — cần thiết để tạo trải nghiệm học tập tốt và vận hành nội dung hiệu quả sau MVP.
>
> `P2` — khác biệt hóa, mở rộng hoặc tối ưu sau khi core product ổn định.
>
> Trạng thái: `Đã có` là chức năng đã có trong backend hiện tại; `Một phần` là có schema hoặc API tối thiểu; `Kế hoạch` là chưa có runtime hoàn chỉnh.

## 1. Cây chức năng tổng thể

```text
HSK System
├── Khách chưa đăng nhập [P0]
│   ├── Đăng ký / Đăng nhập
│   └── Xem nội dung công khai
│
├── User
│   ├── Onboarding & lộ trình ban đầu [P0]
│   │   ├── Xem trạng thái onboarding
│   │   ├── Chọn level/band, thời lượng học và ngày bắt đầu
│   │   ├── Sinh lịch một lesson public mỗi ngày
│   │   └── Placement test: đề xuất điểm bắt đầu (backlog)
│   ├── Tài khoản [P0]
│   │   ├── Xem / cập nhật hồ sơ
│   │   ├── Quản lý phiên đăng nhập
│   │   └── Xóa / xuất dữ liệu tài khoản
│   ├── Lộ trình học HSK [P0]
│   │   ├── Chọn 7 nhóm học: HSK1–HSK6 và HSK7_9
│   │   ├── Xem bài học, chủ đề, câu chuyện
│   │   ├── Theo dõi hoàn thành bài học
│   │   └── Gợi ý bài học tiếp theo
│   ├── Lesson Activity Engine [P0]
│   │   ├── Trắc nghiệm, điền từ, sắp xếp câu
│   │   ├── Nghe và chọn đáp án
│   │   ├── Chấm điểm / feedback tức thời
│   │   └── Lưu lịch sử làm bài luyện
│   ├── Từ điển [P0]
│   │   ├── Tra Hán tự, Pinyin, tiếng Việt / tiếng Anh
│   │   ├── Chi tiết từ: nghĩa, từ loại, ví dụ, audio, cấp HSK
│   │   ├── Simplified / Traditional
│   │   └── Lưu từ vào danh sách ôn
│   ├── Review Center / SRS [P0]
│   │   ├── Flashcard theo từ đã lưu / đã học
│   │   ├── Hàng đợi ôn tập hằng ngày
│   │   ├── Lịch lặp lại ngắt quãng
│   │   └── Lịch sử nhớ / quên và thống kê ôn tập
│   ├── Thi thử [P0]
│   │   ├── Chọn đề và section theo kỹ năng
│   │   ├── Timer, autosave và tiếp tục bài đang làm
│   │   ├── Review đáp án trước khi nộp
│   │   ├── Kết quả, lời giải và phân tích theo skill
│   │   └── Lịch sử thi
│   ├── Đọc tương tác [P1]
│   │   ├── Graded readers / stories theo cấp độ
│   │   ├── Tap-to-lookup trong văn bản
│   │   ├── Audio, highlight câu đang đọc
│   │   └── Lưu từ và tiến độ đọc
│   ├── Phát âm và nói [P1]
│   │   ├── Pinyin / tone foundation
│   │   ├── Ghi âm và phát lại
│   │   ├── Chấm phát âm / phản hồi âm điệu
│   │   └── Shadowing và hội thoại theo tình huống
│   ├── Động lực học tập [P1]
│   │   ├── Daily goal, streak, XP, achievement
│   │   ├── Nhắc lịch ôn tập
│   │   └── Thông báo trong app / email / push
│   ├── Tài liệu học [P1]
│   │   ├── Xem / tải PDF và tài liệu
│   │   └── Nghe audio học tập
│   ├── Trợ lý AI [P2]
│   │   ├── Hỏi đáp từ vựng, ngữ pháp, bài học
│   │   ├── Luyện hội thoại có ngữ cảnh
│   │   ├── Nguồn tham khảo và lịch sử chat
│   │   └── Đánh giá / báo lỗi câu trả lời AI
│   ├── Hanzi nâng cao [P2]
│   │   ├── Stroke order và radical / component
│   │   ├── Luyện viết Hán tự
│   │   ├── Nhận diện chữ viết tay
│   │   └── OCR tra từ bằng camera
│   └── Hỗ trợ người học [P2]
│       ├── FAQ
│       ├── Gửi feedback / báo lỗi nội dung
│       └── Theo dõi yêu cầu hỗ trợ
│
├── Admin
│   ├── Secure Admin Console [P0]
│   │   ├── Same-origin BFF login; bearer token chỉ ở HttpOnly cookie (đã có V1)
│   │   ├── Revalidate current account/role qua /auth/me cho protected access
│   │   ├── Responsive navy/jade admin shell, forbidden/session/error states
│   │   ├── Exercise list server pagination/filter theo Lesson/Topic/type/status
│   │   ├── Exercise detail: content, admin answer, provenance, safe media, revisions
│   │   ├── BFF allowlist/no-store/timeout/safe error; không generic proxy
│   │   ├── Media list/detail: safe metadata, provenance, references (đã có V1)
│   │   ├── Media quarantine/soft archive idempotent qua exact-origin BFF (đã có V1)
│   │   └── Exercise create/review/publish/archive/import UI (backlog)
│   ├── CMS Lite và chất lượng dữ liệu [P0]
│   │   ├── Lesson/Topic immutable revision, review, publish, archive (đã có)
│   │   ├── Exercise draft/revision/review/publish/archive (đã có V1)
│   │   ├── 4 dạng publishable; speaking_repeat chỉ author draft
│   │   ├── Shared NFKC/exact-key/bounded JSON validation cho authoring, import và scoring
│   │   ├── Listening publish với ready audio, URL không whitespace và media projection an toàn
│   │   ├── Preview no-write → hash → atomic/idempotent Exercise import (đã có V1)
│   │   ├── Strict JSON boolean; canonical snapshot/hash không phụ thuộc locale
│   │   ├── Publish lock: admin User SHARE → Lesson/Topic/Exercise UPDATE → Media SHARE
│   │   ├── CRUD level, story và các content entity còn lại (backlog)
│   │   ├── CRUD từ vựng, nghĩa, ví dụ, cấp HSK
│   │   ├── Import generic CSV / JSON cho entity ngoài Exercise (backlog)
│   │   ├── Validate dữ liệu, chống duplicate
│   │   └── Publish / archive nội dung
│   ├── Quản lý thi thử [P0]
│   │   ├── Question bank: HSK, skill, topic, độ khó
│   │   ├── Section, question group và đề thi
│   │   ├── Đáp án, lời giải, version câu hỏi
│   │   └── Import / export đề và câu hỏi
│   ├── Quản lý người dùng [P0]
│   │   ├── Danh sách và hồ sơ người dùng
│   │   ├── Phân quyền user / admin
│   │   ├── Khóa / mở khóa tài khoản
│   │   └── Audit action quản trị
│   ├── Content workflow [P1]
│   │   ├── Draft → review → published → archived (Lesson/Topic đã có ở P0)
│   │   ├── Version nội dung và người duyệt (đã có); lịch publish (backlog)
│   │   └── Báo cáo content thiếu nghĩa, audio hoặc metadata
│   ├── Quản lý media [P1]
│   │   ├── Inventory/filter/pagination + safe detail/provenance (đã có V1)
│   │   ├── Quarantine và soft archive có audit, không hard-delete (đã có V1)
│   │   ├── Content usage/reference và orphan visibility (đã có V1)
│   │   ├── Secure ingestion JPEG/PNG/MP3/WAV: validate, scan, private object storage (đã có V1 API)
│   │   ├── PDF/video upload và thumbnail/variant worker (backlog)
│   │   ├── Transcript / subtitle (backlog)
│   │   └── Liên kết/replace media trên content authoring UI (backlog)
│   ├── Dashboard và báo cáo [P1]
│   │   ├── Tiến độ học và completion rate
│   │   ├── Hiệu suất theo level, topic, skill
│   │   ├── Phân bố điểm và chất lượng câu hỏi
│   │   └── Hoạt động người dùng
│   ├── AI Operations [P1]
│   │   ├── Nguồn knowledge base và ingest status
│   │   ├── Version embedding / prompt / guardrails
│   │   ├── Evaluation set và feedback người học
│   │   └── Theo dõi token cost, latency, lỗi AI
│   ├── Hỗ trợ vận hành [P1]
│   │   ├── Xử lý feedback và report nội dung
│   │   └── Quản lý FAQ
│   └── Growth & monetization [P2]
│       ├── Gói free / premium và entitlement
│       ├── Coupon, subscription, payment
│       ├── Cohort, campaign và thông báo marketing
│       └── Báo cáo doanh thu
│
└── Nền tảng dùng chung
    ├── Xác thực, RBAC, validation, rate limit [P0]
    ├── API contract, error format, migration, seed [P0]
    ├── Privacy, consent, account-data lifecycle [P0]
    ├── Logging, error tracking, metrics, feature flags [P1]
    ├── CI/CD, staging, backup / restore [P1]
    ├── i18n và accessibility [P1]
    ├── Offline download / sync cho mobile [P2]
    └── Community / tutor / social learning [P2]
```

## 2. Ma trận quyền, mức ưu tiên và trạng thái

| Nhóm chức năng | User | Admin | Ưu tiên | Trạng thái hiện tại |
|---|:---:|:---:|:---:|---|
| Đăng ký, đăng nhập, JWT | Có | Có | P0 | Đã có; JWT protected API kiểm tra active account từ DB |
| Onboarding, placement test, learning plan | Có | Cấu hình | P0 | Goal + learning plan V1 runtime hoàn thành; placement scoring còn backlog |
| Hồ sơ cá nhân và privacy lifecycle | Có | Xem | P0 | Schema sẵn sàng; API cập nhật còn thiếu |
| Levels, lessons, topics, stories | Có | CRUD/publish | P0 | Public read + CMS Lite Lesson/Topic publish workflow đã có; Level/Story CMS còn backlog |
| Lesson activity engine | Có | Quản lý nội dung | P0 | Attempt/score/safe media snapshot/progress/resume/completion V1 đã có; speaking/premium entitlement còn backlog |
| Dictionary detail | Có | CRUD/import | P0 | Schema localization/provenance sẵn sàng; API mới chỉ search |
| SRS, flashcard, review queue | Có | — | P0 | Schema SRS sẵn sàng; chưa có runtime |
| Exam delivery và kết quả | Có | Question bank/test | P0 | Schema attempt/autosave/snapshot sẵn sàng; chưa có runtime |
| CMS Lite / import / data validation | — | Có | P0 | Lesson/Topic và Exercise authoring workflow đã có; Exercise preview/atomic import đã có; generic import và CMS entity khác còn backlog |
| Secure admin frontend / Exercise read console | — | Có | P0 | Next.js/BFF HttpOnly session, admin shell và Exercise list/detail read-only đã có V1; mutation UI chưa có |
| RBAC, data privacy, API contract | Có | Có | P0 | RBAC runtime một phần; privacy schema sẵn sàng |
| Interactive reader | Có | Quản lý stories | P1 | Kế hoạch |
| Pronunciation / speaking feedback | Có | Quản lý practice | P1 | Schema một phần, chưa có runtime |
| Media upload / library | Xem | Có | P1 | Inventory/detail/quarantine/soft archive và secure ingestion API JPEG/PNG/MP3/WAV đã có; upload UI/PDF/video/worker còn backlog |
| Gamification và notification | Có | Cấu hình | P1 | Kế hoạch |
| Dashboard, analytics, support console | Xem cá nhân | Có | P1 | Kế hoạch |
| Observability, CI/CD, staging | — | Vận hành | P1 | Kế hoạch |
| AI/RAG có nguồn tham khảo | Có | AI Operations | P2 | Kế hoạch |
| Stroke order, handwriting, OCR | Có | Quản lý asset | P2 | Kế hoạch |
| Subscription/payment, mobile offline, community | Có | Có | P2 | Kế hoạch |

## 3. Chức năng backend đang có

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`.
- `GET /api/v1/users/me` và `GET /api/v1/users` cho admin.
- `GET /api/v1/health`.
- `GET /api/v1/dictionary?query=...`.
- `GET /api/v1/levels`, `/lessons`, `/topics`, `/stories` và các endpoint tương đương dưới `/learning`.
- `GET /api/v1/onboarding/status`, `GET /api/v1/onboarding/goals/current`, `POST /api/v1/onboarding/goals`.
- `GET /api/v1/learning-plans/current`, `POST /api/v1/learning-plans`.
- `GET|POST /api/v1/admin/cms/lessons` và Lesson revision/review/publish/archive endpoints.
- `POST /api/v1/admin/cms/topics`, `GET /api/v1/admin/cms/topics/:topicId` và Topic revision/review/publish/archive endpoints.
- `GET|POST /api/v1/admin/cms/exercises`, Exercise detail/revision/review/publish/archive endpoints.
- `POST /api/v1/admin/cms/exercise-imports/preview` và `POST /api/v1/admin/cms/exercise-imports`.
- `GET /api/v1/admin/cms/media`, detail và `POST` quarantine/soft archive cho admin.
- `POST /api/v1/learning/lessons/:lessonId/start|complete`, `GET /api/v1/learning/lessons/:lessonId/activity`.
- `POST /api/v1/learning/topics/:topicId/start|complete`, `GET|POST /api/v1/learning/exercises/:exerciseId/attempts`.
- `GET /api/v1/progress/lessons` và `GET /api/v1/progress/lessons/:lessonId`.

Onboarding Goal & Learning Plan V1 dùng JWT owner, khóa row `User` cho write concurrency, date-only schedule và chỉ chọn Lesson ready. Status phân biệt plan active với plan usable theo snapshot Lesson ready chính xác, đồng thời trả `content_unavailable` khi level chưa có content dùng được. CMS Lite append immutable `ContentRevision`/`ContentReview`, giữ nguyên live content khi có draft revision mới và ghi audit summary an toàn. Exercise V1 publish theo lock order `active admin User FOR SHARE → Lesson/Topic/LessonExercise FOR UPDATE → Media FOR SHARE khi listening` với role/lifecycle được enforce, shared NFKC/exact-key/bounded validator, chỉ publish latest-approved revision dưới parent live/coherent, bắt buộc ready/live audio có URL nonempty/no-whitespace cho listening và import theo preview hash + atomic/idempotent commit từ 1 đến 100 rows. Import lock actor rồi DataSource và parent IDs `FOR UPDATE` theo thứ tự ổn định; interactive transaction dùng `maxWait=5.000 ms` và `timeout=30.000 ms`. Lesson Activity V1 serialize write theo User, chấm `mcq`, `listening_choice`, `fill_blank`, `arrange_sentence` trên server, lưu immutable snapshot/event, derive progress và resume pointer; không nhận score/progress/userId từ client. `speaking_repeat` chỉ được lưu draft và chưa được publish/chấm. Các cờ boolean chỉ nhận JSON boolean thật. Placement test/scoring, SRS và premium entitlement chưa có runtime.

Chi tiết contract mục tiêu nằm trong [api.md](./api.md). Khi thêm endpoint mới, cần cập nhật cả tài liệu API, DTO và test tương ứng.

## 4. Quy tắc phân quyền và dữ liệu

- Mặc định, dữ liệu cá nhân chỉ chủ sở hữu được xem hoặc thay đổi.
- Các thao tác quản trị nội dung, người dùng, đề thi, tài nguyên và báo cáo yêu cầu role `admin`.
- Endpoint công khai chỉ được trả nội dung có trạng thái `published` và chưa bị soft-delete.
- Lesson chỉ được coi là ready khi Level cha cũng public và có ít nhất một Topic hoặc Story public; cùng policy áp dụng cho learning, onboarding và CMS publish.
- Public Lesson không trả Topic/Story/Word/Exercise draft hoặc soft-deleted, không trả `speaking_repeat`, và không bao giờ trả `LessonExercise.answer`; Exercise gắn Topic chỉ visible khi Topic đó cũng public.
- Public listening exercise chỉ hiện khi media là audio `ready`, chưa soft-delete và URL không rỗng/không whitespace; response/snapshot công khai chỉ giữ `id`, `url`, `type`, `mimeType`, `duration`, không lộ storage/checksum/processing metadata. Quarantine/soft-archive Media sau publish được phép và làm public ẩn Exercise ngay, nhưng không rewrite immutable attempt snapshot cũ.
- Kết quả thi phải snapshot câu hỏi/đáp án/lời giải tại thời điểm nộp để dữ liệu lịch sử không bị thay đổi theo nội dung mới.
- AI gateway phải xác thực người dùng, giới hạn tần suất và chỉ gọi RAG service; không đặt logic RAG lõi trong backend.
- Dữ liệu từ điển, audio và nội dung phải có nguồn gốc/version để hỗ trợ kiểm soát chất lượng và bản quyền.

## 5. Thứ tự triển khai đề xuất

1. **P0 — Data + CMS Lite:** Lesson/Topic, Exercise authoring/import/console, Media Operations/Admin Library và secure ingestion API V1 đã có; tiếp theo là dữ liệu HSK1–HSK6 + HSK7_9 và CMS/import cho entity còn lại.
2. **P0 — Learning + Review:** Lesson Activity Attempt & Progress V1 đã hoàn thành; tiếp theo triển khai SRS/flashcard trên `ReviewCard` source of truth.
3. **P0 — Exam:** question bank, test, autosave, scoring theo skill, snapshot và result analysis.
4. **P0 — Web MVP:** admin auth/BFF + Exercise read console đã có; tiếp tục learner auth, learning, dictionary, review và exam theo vertical slice.
5. **P1:** interactive reader, phát âm/nói, media, notification, analytics, staging/CI/CD.
6. **P2:** AI/RAG, handwriting/OCR, subscription, mobile offline và community.
