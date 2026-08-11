# HSK System - Project Context For AI

## 1. Muc dich tai lieu

Tai lieu nay la "context pack" de AI agent, dev moi, hoac tool tu dong hieu nhanh toan bo du an:

- San pham dang giai quyet van de gi.
- Chuc nang nguoi dung va admin.
- Kien truc he thong va vai tro tung service.
- Cong nghe cot loi dang dung.
- Model du lieu, API contract, pipeline du lieu.
- Trang thai hien tai va huong mo rong.

Tai lieu duoc viet theo trang thai repo hien tai tai `hsk-system/`.

## 2. Tong quan san pham

### 2.1 Bai toan

Xay dung nen tang on thi HSK 1-9 (phien ban 3.0) theo 7 nhom curriculum `HSK1`...`HSK6`, `HSK7_9` cho:

- Hoc sinh/sinh vien/nguoi di lam hoc tieng Trung.
- Admin quan tri noi dung, nguoi dung, de thi, tai lieu, bao cao.

### 2.2 Gia tri chinh

- Hoc theo cap do HSK.
- Hoc theo bai hoc, chu de, cau chuyen.
- Luyen 4 ky nang.
- Thi trac nghiem va xem giai thich ket qua.
- Tra cuu tu dien va theo doi tien do hoc.
- Tich hop AI assistant (RAG) de giai thich kien thuc.

## 3. User personas

### 3.1 Nguoi dung (`role=user`)

- Dang ky/dang nhap.
- Chon cap do HSK.
- Hoc bai hoc/chu de/cau chuyen.
- Lam bai thi.
- Xem ket qua va lich su hoc tap.
- Theo doi tien do va tu vung da hoc.

### 3.2 Admin (`role=admin`)

- Quan ly nguoi dung.
- Quan ly noi dung hoc (level, lesson, topic, story).
- Quan ly ngan hang cau hoi/de thi.
- Quan ly tai lieu (PDF, audio, anh, giao trinh).
- Xem bao cao va thong ke he thong.

## 4. Luong nghiep vu cot loi

1. Dang ky/Dang nhap.
2. Chon nhom curriculum HSK1-HSK6 hoac HSK7_9 (band 7-9).
3. Chon bai hoc/chu de/cau chuyen.
4. Hoc va luyen tap.
5. Lam bai thi.
6. Nop bai.
7. Xem ket qua + giai thich.
8. Luu tien do hoc + lich su ket qua.

## 5. Kien truc tong the

Du an dung mo hinh:

- Modular Monolith cho core product.
- AI service tach rieng de scale doc lap.

### 5.1 Repository layout

```text
hsk-system/
  backend/    # NestJS core API + business domains
  frontend/   # UI app (public + admin)
  ai/         # RAG/embeddings service va pipelines
  docs/       # tai lieu he thong
```

### 5.2 Vai tro tung layer

- `frontend`: giao dien nguoi dung va admin, goi API backend.
- `backend`: auth, business logic, DB CRUD, exam scoring, progress tracking.
- `ai`: ingest data, retrieval, chat assistant, embeddings pipeline.

## 6. Backend context (chi tiet)

## 6.1 Stack backend hien tai

- Framework: NestJS 11
- Runtime: Node.js + TypeScript
- ORM: Prisma 5
- DB: PostgreSQL
- API prefix: `/api/v1` (da bat trong `src/main.ts`)
- Testing: Jest (unit/e2e scaffold)

## 6.2 Cau truc backend chinh

`backend/src/modules` da duoc chia theo domain:

- `auth`
- `cms` (CMS Lite Lesson/Topic)
- `learning/activity` (Lesson Activity Attempt & Progress V1)
- `users`
- `levels`
- `lessons`
- `topics`
- `stories`
- `dictionary`
- `progress`
- `materials`
- `admin`
- `analytics`
- `exam/question`
- `exam/test`
- `exam/result`
- `ai/chat` (gateway only, khong chua RAG logic)

`backend/src` co them:

- `common/` (decorators, guards, filters, interceptors, constants, utils)
- `shared/` (dto, types, interfaces)
- `config/` (`app.config.ts`, `database.config.ts`, `env.validation.ts`)
- `prisma/` (`prisma.module.ts`, `prisma.service.ts`)
- `infrastructure/` (`storage`, `mail`, `queue`)

## 6.3 Du lieu va schema (Prisma)

File nguon: `backend/prisma/schema.prisma`

### Entities chinh

- `User`: tai khoan, role (`user` | `admin`)
- `Level`: cap do HSK
- `Lesson`: bai hoc theo level
- `Topic`: noi dung theo lesson
- `Story`: bai doc/cau chuyen theo level
- `Question`: cau hoi thi (type/skill/answers/correctAnswer)
- `Test`: de thi
- `TestQuestion`: mapping de thi <-> cau hoi
- `Result`: ket qua bai thi cua user
- `Word`: tu vung han tu
- `WordLevel`: mapping tu vung <-> level
- `LessonWord`: mapping tu vung <-> lesson
- `UserWord`: tu vung user da luu
- `Progress`: tien do hoc theo lesson
- `UserWordProgress`: trang thai hoc tu vung

Schema P0 moi bo sung:

- Identity/privacy: `UserProfile`, `UserSession`, token hash, `UserGoal`, `PlacementAttempt`, `LearningPlan`, `Consent`, export/delete request.
- CMS/provenance: `DataSource`, `WordSource`, `ContentRevision`, `ContentReview`, `AuditLog`, `ImportJob`, `ImportRowError`.
- Learning/SRS: progress chi tiet, `UserTopicProgress`, `LearningEvent`, `ReviewCard`, `ReviewSession`, `ReviewEvent`.
- Exam: `TestQuestionPlacement`, `ExamAttempt`, `ExamAnswer`, `ExamAttemptSnapshot`, `ExamAttemptEvent`.

### Enums

- `Role`: `user`, `admin`
- `QuestionType`: `mcq`, `listening`, `reading`
- `Skill`: `listening`, `reading`, `writing`
- `ProgressStatus`: `not_started`, `learning`, `done`
- `WordProgressStatus`: `learning`, `done`

`UserWordProgress` duoc giu cho compatibility/summary; `ReviewCard` la source of truth duy nhat cho scheduler SRS P0.

## 6.4 API contract

Ban dac ta API chi tiet nam o:

- `docs/api.md`

Tieu chuan:

- Base path: `/api/v1`
- Auth: `Bearer JWT`
- Response format co `success`, `data/error`, `meta`
- Co pagination convention (`page`, `limit`, `sortBy`, `sortOrder`)

## 6.5 Upload va logs

- Upload local hien tai: `backend/uploads/{audio,images,documents}`
- Logs folder: `backend/logs/`

Note:

- Local uploads phu hop giai doan dau.
- Production nen chuyen sang S3/Cloudinary/GCS.

## 7. Data pipeline context

## 7.1 Dictionary pipeline

Duong dan: `backend/scripts/dictionary/`

- `raw/`: du lieu goc (`HSK 1-9`, `cedict`, txt/json)
- `parsed/`: parse output
- `normalized/`: du lieu da clean/chuan hoa
- `parse.ts`: tach du lieu tu raw
- `normalize.ts`: clean/chuan hoa field
- `seed.ts`: nap vao DB
- `convert-hsk.ts`: convert dataset hsk (neu can)

Pipeline de xuat:

1. `raw` -> `parse.ts` -> `parsed`
2. `parsed` -> `normalize.ts` -> `normalized`
3. `normalized` -> `seed.ts` -> PostgreSQL

## 7.2 Level seed

Duong dan: `backend/scripts/levels/seed.ts`

- Seed danh muc cap do HSK.

## 7.3 AI scripts

Duong dan: `backend/scripts/ai/embeddings/`

- Chuan bi scripts lien quan embedding tai backend side (neu can gateway/preprocess).

## 8. Frontend context

## 8.1 Trang thai

- Frontend da co bo khung thu muc theo feature/domain.
- Code app thuc te hien tai chua day du (moi co mot so file scaffold nhu `layout.tsx`, `page.tsx`).

## 8.2 Cau truc muc tieu

`frontend/src/app`:

- `(public)/home`
- `(public)/knowledge`
- `(public)/exam`
- `(public)/materials`
- `(public)/account`
- `admin/dashboard`
- `admin/users`
- `admin/content`
- `admin/reports`

`frontend/src/features`:

- `auth`, `levels`, `lessons`, `dictionary`, `exam`, `materials`, `progress`, `analytics`, `admin`

`frontend/src/components`:

- `layout`, `knowledge`, `exam`, `materials`, `account`, `chatbot`

## 8.3 Public assets

- `frontend/public/images`
- `frontend/public/audio`
- `frontend/public/docs`

## 9. AI service context

## 9.1 Vai tro AI service

Folder: `ai/`

Day la service doc lap cho:

- Ingest tai lieu hoc.
- Tao embeddings.
- Retrieval theo ngu nghia.
- Chat assistant (RAG) co source grounding.

## 9.2 Cau truc chinh

- `ai/services/rag-api/src/modules/chat`
- `ai/services/rag-api/src/modules/ingest`
- `ai/services/rag-api/src/modules/retrieval`
- `ai/services/rag-api/src/core/providers`
- `ai/services/rag-api/src/workers`
- `ai/pipelines/{dictionary,materials,embeddings,evaluation}`
- `ai/data/{raw,processed,vectorstore}`
- `ai/models/{prompts,schemas}`

## 9.3 Boundary voi backend

Backend chi la API gateway (`backend/src/modules/ai/chat`) va khong chua logic RAG cot loi.

Nguyen tac:

- Business/auth/data chinh o backend.
- LLM/retrieval/embedding o `ai/`.

## 10. Cong nghe su dung

## 10.1 Hien tai (xac nhan trong repo)

- Backend: NestJS, Prisma, PostgreSQL, Jest, ESLint, Prettier.
- Frontend: khung source da tao (package hien tai dang de trong, can chot framework chay that su).
- AI: khung `rag-api` da tao (package hien tai dang de trong, can khai bao dependency va boot logic).

## 10.2 Theo dinh huong kien truc san pham (tu mockup + roadmap)

- Frontend target: Next.js hoac Flutter Web (image de xuat Flutter cho web/android).
- Infra target: Docker, Nginx, Redis.
- Storage target: Cloudinary/S3.
- Security target: JWT, bcrypt, HTTPS, rate limit.
- AI target: OpenAI/Gemini API + vector DB (Pinecone/Weaviate/LlamaIndex/LangChain tuong ung roadmap).

## 11. Trang thai thuc thi hien tai

### Da co

- Kien truc thu muc production-grade.
- Schema Prisma va migrations ban dau.
- API prefix `/api/v1`.
- Docs API + roadmap.
- Data raw HSK + pipeline dictionary.
- Active-account JWT authorization va Onboarding Goal & Learning Plan V1.
- CMS Lite publish workflow cho Lesson/Topic va shared Lesson readiness policy.
- Lesson Activity Attempt & Progress V1 voi server scoring, immutable snapshot/event, derived progress va resume.

### Chua day du

- Nhieu module backend moi o muc skeleton (chua co controller/service logic day du).
- Frontend va AI service chua hoan thien package dependencies va code runtime.
- Chua co CI/CD, observability, security hardening day du.

## 12. Quy tac cho AI agent khi thao tac tren repo nay

1. Uu tien doc `docs/api.md`, `docs/roadmap.md`, `backend/prisma/schema.prisma` truoc khi sua code.
2. Giu boundary ro:
- Khong dua RAG logic vao `backend`.
- Khong dua business core vao `ai/`.
3. Khi them endpoint:
- Cap nhat `docs/api.md`.
- Dong bo DTO/types va test.
4. Khi sua data pipeline:
- Khong sua truc tiep file trong `raw/`.
- Parse -> normalize -> seed theo dung pipeline.
5. Khi thay doi schema:
- Tao migration Prisma moi.
- Ghi ro impact toi API.

## 13. Tai lieu lien quan

- API spec: `docs/api.md`
- Product roadmap: `docs/roadmap.md`
- ERD image: `docs/erd.png`
- Architecture concept image: `d:/HanziiApp/ChatGPT Image 16_25_28 4 thg 5, 2026.png`

## 14. Quick start cho AI assistant

Neu ban la AI duoc giao tiep tuc du an nay, thu tu uu tien:

1. Xac nhan backend boot duoc (`/api/v1`).
2. Hoan thien module auth/users.
3. Hoan thien exam flow (question/test/result + submit scoring).
4. Hoan thien dictionary API va progress tracking.
5. Ket noi frontend den API.
6. Mo rong AI assistant qua `backend/modules/ai/chat` -> `ai/services/rag-api`.

## 15. P0 schema baseline + integrity hardening — 10/08/2026

- Migration chain: 14 migration, gom 5 migration lich su, P0-00...P0-04, `p0_integrity_hardening`, `p0_integrity_concurrency_serialization`, `content_review_immutability` va `lesson_activity_integrity`.
- Schema sau rehearsal: 57 business tables, 138 foreign keys, 72 CHECK constraints va 29 trigger nghiep vu.
- `Level` co stable code; `HSK7_9` dai dien band 7-9, khong tach thanh ba level o P0.
- Email duoc canonicalize `trim().toLowerCase()` trong Auth runtime va unique theo `lower(email)` tai PostgreSQL.
- Token session/reset/verification chi co cot `tokenHash`; khong co raw token column.
- Dictionary legacy duoc backfill provenance: CC-CEDICT co source/license/hash da xac minh tu header; cac HSK word list co hash nhung license van phai duoc curriculum owner xac minh truoc production.
- 200.156 meaning hien co duoc giu nguyen va co thu tu/normalized English/provenance; khong tu dong dich tieng Viet.
- Cross-table trigger bao ve Story-Lesson-Level, Topic-Lesson children va pronunciation target.
- Target/awarded band phai nam trong Level range; ReviewEvent card/session phai cung user.
- Immutable fact dung FK `RESTRICT`; account deletion la lifecycle + anonymization theo ADR-001, khong hard-delete User/Lesson/ReviewSession.
- Exam snapshot va append-only events duoc bao ve; placement cau hoi nam tai `TestQuestionPlacement`, khong con nam tren `Question`.
- Public levels/words chi tra `published` va chua soft-delete; pinyin lookup dung `pinyinNormalized` va partial prefix index.
- Database local data khong duoc dung cho destructive/E2E test; `TEST_DATABASE_URL` phai tro den PostgreSQL disposable.

Tai lieu chi tiet:

- `docs/database/P0_DATA_DICTIONARY.md`
- `docs/database/P0_ERD.md`
- `docs/database/P0_SCHEMA_MIGRATION_RUNBOOK.md`
- `docs/adr/ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md`

Schema da san sang cho runtime P0. Onboarding goal + learning plan V1, CMS Lite Lesson/Topic va Lesson Activity Attempt & Progress V1 da co runtime voi active-account JWT authorization, row locking, immutable facts, stable published content va idempotency. Placement scoring, import, CMS cho entity khac, SRS/exam API va frontend van la backlog.

## 16. CMS Lite Publish Workflow & Lesson Readiness V1 — 10/08/2026

- Module runtime: `backend/src/modules/cms`; admin routes dung prefix `/api/v1/admin/cms` va bat buoc `JwtAuthGuard` + `RolesGuard` + `admin` role tu database hien tai.
- V1 chi quan ly Lesson va Topic. Create tao draft + revision 1; edit chi append `ContentRevision`; review append `ContentReview`; publish chi chap nhan revision moi nhat co latest decision `approved`; archive la soft lifecycle.
- Snapshot chi chua mutable domain fields. Hash SHA-256 duoc tinh tren canonical JSON sort object key theo UTF-16 code unit, khong phu thuoc locale; array order duoc giu nguyen va unsupported value bi reject.
- Khong backfill hash cu. Idempotency cua revision/publish so sanh them canonical snapshot de tuong thich voi hash legacy tung duoc tao boi comparator phu thuoc locale.
- Lock order CMS la `Lesson → Topic`; moi Topic mutation/review deu lock parent Lesson truoc Topic. Khi live row da published, draft revision moi khong overwrite row va public van thay version cu den khi publish atomically.
- CMS concurrency harness goi truc tiep public methods cua `CmsService`. `CmsTransactionCoordinator` production mac dinh no-op chi cung cap checkpoint DI quanh real lock de test quan sat PostgreSQL `wait_event_type=Lock`; runner khong co lock/business implementation rieng.
- Audit summary chi co entity type/id, action, revision, status va content hash. `ContentRevision`, `ContentReview` va `AuditLog` deu co database immutable trigger; review retry giong nhau khong tao duplicate fact.
- Shared readiness policy: Lesson va Level cha deu published/chua deleted, dong thoi co it nhat mot Topic hoac Story linked public. Exercise khong bat buoc V1.
- Learning list/detail, Topic/Story relation, CMS publish validation va onboarding plan dung cung readiness predicate. Onboarding status phan biet active/usable plan theo exact lesson snapshot va co `content_unavailable`; no-ready-content tra `409` truoc khi cancel plan active.
- Public detail loc Topic, Story, Word va Exercise theo public visibility; serializer khong chon/tra `LessonExercise.answer` hoac explanation/internal metadata.
- E2E bao phu stale publish, review reject/request-change, concurrent revision numbering, publish idempotency, stable live content, child visibility, audit/immutable trigger va stale admin token.
- JSON boolean flags trong CMS/onboarding chi nhan literal `true`/`false`; string, number, null, object va array bi reject tai HTTP boundary.
- Backlog gan: Level/Story/Word/Exercise CMS, import preview/validate/commit, four-eyes approval, scheduled publish, OpenAPI va admin frontend.

## 17. Lesson Activity Attempt & Progress V1 — 11/08/2026

- Runtime nam tai `backend/src/modules/learning/activity`; route write/read dung JWT owner, positive safe integer path ID va strict DTO.
- Tat ca activity write cua cung user lock active `User FOR UPDATE`, sau do `Progress → UserTopicProgress`. `LessonActivityTransactionCoordinator` la no-op DI checkpoint quanh production lock de concurrency harness quan sat backend PID/Lock ma khong copy business logic.
- Idempotency key dai 8-128 ky tu, unique theo user tren `LearningEvent`; attempt semantic hash dung canonical JSON. Retry khong tao attempt/event, khong tang attempt number, duration hay progress.
- Scorer `lesson-activity-v1` ho tro `mcq`, `listening_choice`, `fill_blank`, `arrange_sentence`; `speaking_repeat` tra 422 den khi co pronunciation engine. Malformed authoring rollback toan bo.
- Attempt snapshot lay tu DB trong transaction va chua authoritative answer de render lich su, nhung response serializer chi lo safe result summary. History owner van doc duoc sau archive va khong join live content de viet lai ket qua.
- Topic/Lesson progress duoc derive tu submitted fact: distinct required exercise, explicit topic/lesson completion, best-score average rounded va total duration. Resume sort `orderIndex,id`, bo content archive khi read ma khong rewrite history.
- Migration `20260810210000_lesson_activity_integrity` fail-safe tren legacy incoherence, khoa UPDATE/DELETE submitted attempt, validate LearningEvent cross-reference va chan doi parent location sau khi co history.
- Production-path concurrency harness bao phu same key, different key numbering, submit/topic complete, final attempt/lesson complete va retry sau lock timeout; moi race phai quan sat B o `wait_event_type=Lock` truoc khi release A.
- Backlog ro rang: SRS, exam, speaking/pronunciation scoring, premium entitlement va published-learning content version pinning.
