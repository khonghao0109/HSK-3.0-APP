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
- `cms` (CMS Lite Lesson/Topic + Exercise Authoring & Import Validation V1)
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

- `common/` (decorators, guards, filters, interceptors, constants, utils, shared LessonExercise NFKC/exact-key/bounds validation)
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
- CMS/provenance: `DataSource`, `WordSource`, `ContentRevision`, `ContentReview`, `AuditLog`, `ImportJob`, `ImportRowError`; `LessonExercise` co media/provenance/actor/publish metadata va archive-only database policy.
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

- Frontend Next.js 16.3 App Router + React 19 + TypeScript strict da chay duoc,
  co npm lockfile rieng, production build, Vitest/RTL va Playwright/axe.
- `Frontend Platform Foundation, Secure Admin Session & Exercise Read Console V1`
  da co runtime: login admin qua same-origin BFF, protected admin shell, Exercise
  list/detail read-only, safe states va responsive UI.
- Browser khong nhan bearer token. Token chi nam trong HttpOnly/SameSite cookie;
  backend URL la server-only va moi protected access revalidate `/auth/me`.

## 8.2 Cau truc hien tai va muc tieu

`frontend/src/app` hien co:

- `(auth)/login`, `forbidden` va global error/not-found states.
- `admin/exercises` va `admin/exercises/[exerciseId]` duoi protected layout.
- `api/session/{login,logout,me}` va allowlisted
  `api/admin/exercises[/id]` BFF routes.

`frontend/src/features` hien co `auth`, `admin-shell`, `exercises`; cac feature
learning, dictionary, review, exam, materials, account va analytics van la cac
vertical slice tiep theo.

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
- Frontend: Next.js 16.3, React 19, TypeScript 6 strict, Zod, CSS variables,
  Vitest/React Testing Library, Playwright/axe, npm lockfile.
- AI: khung `rag-api` da tao (package hien tai dang de trong, can khai bao dependency va boot logic).

## 10.2 Theo dinh huong kien truc san pham (tu mockup + roadmap)

- Frontend web da chot Next.js App Router; mobile native/Flutter chi danh gia lai
  khi co boundary san pham rieng, khong thay frontend web hien tai.
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
- Exercise Authoring & Import Validation V1: shared NFKC validator, revision/review/publish/archive, listening media readiness va preview/atomic import.
- Lesson Activity Attempt & Progress V1 voi server scoring, immutable snapshot/event, derived progress va resume.
- Secure Admin Session & Exercise Read Console V1 voi BFF HttpOnly cookie,
  role/account revalidation va real-backend browser test.
- Media Asset Operations/Admin Library V1 voi safe inventory/detail,
  quarantine/soft archive va exact-origin BFF.

### Chua day du

- Nhieu module backend moi o muc skeleton (chua co controller/service logic day du).
- Public learner frontend va AI service chua hoan thien runtime; admin frontend
  moi co Exercise read console va Media operations/library V1.
- Chua co CI/CD, observability, security hardening day du.
- Exercise V1 frozen artifact da pass full release gate; speaking publish/scoring, generic import va CMS entity khac van la backlog.

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
- P0 database runbook: `docs/database/P0_SCHEMA_MIGRATION_RUNBOOK.md`
- Exercise authoring decision: `docs/adr/ADR-002-EXERCISE-AUTHORING-VERSION-MEDIA-IMPORT-ATOMICITY.md`
- Architecture concept image: `d:/HanziiApp/ChatGPT Image 16_25_28 4 thg 5, 2026.png`

## 14. Quick start cho AI assistant

Neu ban la AI duoc giao tiep tuc du an nay, thu tu uu tien:

1. Xac nhan backend boot duoc (`/api/v1`).
2. Hoan thien module auth/users.
3. Hoan thien exam flow (question/test/result + submit scoring).
4. Hoan thien dictionary API va progress tracking.
5. Ket noi frontend den API.
6. Mo rong AI assistant qua `backend/modules/ai/chat` -> `ai/services/rag-api`.

## 15. P0 schema baseline + integrity hardening — 11/08/2026

- Migration chain: 15 migration, gom 5 migration lich su, P0-00...P0-04, `p0_integrity_hardening`, `p0_integrity_concurrency_serialization`, `content_review_immutability`, `lesson_activity_integrity` va `exercise_authoring_import_validation_v1`.
- Schema sau migration thu 15 tren fresh disposable database: 57 business tables, 143 foreign keys, 78 CHECK constraints va 33 custom trigger.
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
- `docs/adr/ADR-002-EXERCISE-AUTHORING-VERSION-MEDIA-IMPORT-ATOMICITY.md`

Schema da san sang cho runtime P0. Onboarding goal + learning plan V1, CMS Lite Lesson/Topic, Exercise Authoring & Import Validation V1 va Lesson Activity Attempt & Progress V1 da co implementation voi active-account JWT authorization, row locking, immutable facts, stable published content va idempotency. Placement scoring, generic import/CMS cho entity khac, SRS/exam API va frontend van la backlog. Exercise frozen artifact da co bang chung full release gate tren cac fresh disposable database rieng.

## 16. CMS Lite Publish Workflow & Lesson Readiness V1 — 10/08/2026

- Module runtime: `backend/src/modules/cms`; admin routes dung prefix `/api/v1/admin/cms` va bat buoc `JwtAuthGuard` + `RolesGuard` + `admin` role tu database hien tai.
- Phan Lesson/Topic V1 quan ly Lesson va Topic. Exercise authoring/import duoc mo rong rieng tai muc 18. Create tao draft + revision 1; edit chi append `ContentRevision`; review append `ContentReview`; publish chi chap nhan revision moi nhat co latest decision `approved`; archive la soft lifecycle.
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
- Backlog gan: Level/Story/Word/Question/Test/Media CMS, generic import ngoai Exercise, four-eyes approval, scheduled publish, OpenAPI va admin frontend.

## 17. Lesson Activity Attempt & Progress V1 — 11/08/2026

- Runtime nam tai `backend/src/modules/learning/activity`; route write/read dung JWT owner, positive safe integer path ID va strict DTO.
- Tat ca activity write cua cung user lock active `User FOR UPDATE`; content-targeted write tiep tuc shared lock `Lesson → Topic → LessonExercise`, roi `Progress → UserTopicProgress`. `LessonActivityTransactionCoordinator` la no-op DI checkpoint quanh production lock de concurrency harness quan sat backend PID/Lock ma khong copy business logic.
- Idempotency key dai 8-128 ky tu, unique theo user tren `LearningEvent`; attempt semantic hash dung canonical JSON. Retry khong tao attempt/event, khong tang attempt number, duration hay progress.
- Scorer `lesson-activity-v1` ho tro `mcq`, `listening_choice`, `fill_blank`, `arrange_sentence`; `speaking_repeat` tra 422 den khi co pronunciation engine. Malformed authoring rollback toan bo.
- Attempt snapshot lay tu DB trong transaction va chua authoritative answer de render lich su, nhung response serializer chi lo safe result summary. History owner van doc duoc sau archive va khong join live content de viet lai ket qua.
- Topic/Lesson progress duoc derive tu submitted fact: distinct required exercise, explicit topic/lesson completion, best-score average rounded va total duration. Resume sort `orderIndex,id`, bo content archive khi read ma khong rewrite history.
- Migration `20260810210000_lesson_activity_integrity` fail-safe tren legacy incoherence, khoa UPDATE/DELETE submitted attempt, validate LearningEvent cross-reference va chan doi parent location sau khi co history.
- Production-path concurrency harness bao phu same key, different key numbering, submit/topic complete, final attempt/lesson complete va retry sau lock timeout; moi race phai quan sat B o `wait_event_type=Lock` truoc khi release A.
- Backlog ro rang: SRS, exam, speaking/pronunciation scoring, premium entitlement va published-learning content version pinning.

## 18. Exercise Authoring & Import Validation V1 — 11/08/2026

### 18.1 Runtime boundary va routes

- Runtime o `backend/src/modules/cms/exercise-authoring.service.ts` va `backend/src/modules/cms/exercise-import`; controller dung `/api/v1/admin/cms`, JWT active-account + role `admin`.
- Routes: list/detail/create Exercise; create revision; append review; publish latest-approved revision; archive; import preview; import commit.
- Shared contract o `backend/src/common/validation/lesson-exercise-authoring.validator.ts`; create/revision/import/scorer khong duoc tu dinh nghia shape khac nhau.
- Bon type publishable la `mcq`, `listening_choice`, `fill_blank`, `arrange_sentence`. `speaking_repeat` co the luu draft co shape an toan nhung publish tra `422` cho den khi co pronunciation engine.

### 18.2 Validation va version contract

- Human text va stable ID duoc normalize NFKC. Top-level exact keys: `type`, `prompt`, `content`, `answer`, `explanation`, `mediaId`; subtype cung reject field du. Field la trong authoring/import/DTO luon dung safe path `$.$unknown`, khong phan chieu property do client kiem soat.
- Bound chung: canonical JSON 65.536 byte, depth 8, string 4.096 ky tu, array 100; stable ID toi da 128 ky tu, khong whitespace; boolean chi nhan JSON boolean.
- Choice dung stable option ID va authoritative `answer.optionId` phai co trong options. Fill blank normalize NFKC/trim/collapse whitespace. Arrange answer phai la dung va du token set, khong duplicate.
- Create tao draft + revision/version 1. Draft revision moi duoc materialize vao live row; revision moi tren row da published khong thay live version/content. Chi latest revision co latest review `approved` duoc publish atomically va luc do `version = revision.revision`.
- Create/revision/review/publish yeu cau Lesson/Topic parent live va coherent. Archive Exercise van hop le sau khi parent archive de cleanup; `status=archived` va `deletedAt` phai cung trang thai.
- Snapshot/hash dung canonical JSON + SHA-256. Audit chi luu summary an toan; khong luu raw answer/payload. `ContentRevision`/`ContentReview` la history append-only va `LessonExercise` la archive-only.

### 18.3 Media va learning hand-off

- Chi `listening_choice` duoc mang `mediaId`. Listening publish bat buoc `Media` audio, `processingStatus=ready`, `deletedAt IS NULL`, URL nonempty va khong co whitespace; service khoa Media `FOR SHARE`, sau do service validation, CHECK va database trigger cung enforce.
- Public projection/snapshot chi co `id`, `url`, `type`, `mimeType`, `duration`; khong co storage provider/key, original filename, checksum hay processing metadata.
- Public query chi tra 4 type publishable; listening da mat readiness bi an; Exercise co `topicId` chi visible khi Topic public. Learner submit khoa cung hierarchy voi publish, sau do attempt pin `exerciseVersion`, content, authoritative answer va safe media trong immutable snapshot.
- Safety workflow van duoc quarantine/soft-archive Media sau publish; public query/serializer an Exercise ngay khi readiness mat. Immutable attempt snapshot cu khong bi rewrite va van giu safe projection de replay, khong lam lo metadata noi bo qua response.

### 18.4 Import contract

- Preview la no-write read/validation phase. Input gom `dataSourceId`, NFKC/trim `fileName`, bat buoc 1-100 row; row exact keys va dung chung authoring validator.
- `previewHash` la SHA-256 tren canonical contract version, source, file, normalized ordered rows va sorted structural errors. Relational state khong dong bang trong hash; commit bat buoc gui lai dung payload/hash va lookup/revalidate parent/media/existing key trong transaction.
- Commit lock active admin actor `User FOR SHARE`, `DataSource FOR UPDATE`, cac Lesson ID `FOR UPDATE` tang dan roi Topic ID `FOR UPDATE` tang dan; role/admin lifecycle duoc enforce. Sau do service kiem tra lai parent, Media va `(dataSourceId, sourceKey)`, ghi mot `ImportJob.completed`, tat ca draft Exercise + revision 1 va audit trong transaction all-or-nothing co `maxWait=5.000 ms`, `timeout=30.000 ms`.
- `Idempotency-Key` la global unique persistence key. Retry cung actor/source/file/hash/entity chi thanh cong sau khi revalidate current rows va job `completed` co started/completed timestamps, zero errors, exact counts, canonical sourceKey array khop chinh xac ca gia tri/thu tu, du Exercise + revision 1 va dung mot completion audit. Matching job `pending`/`failed`/incomplete hoac provenance incoherent tra safe `409` manual review; cung key khac request cung tra `409`.
- Duplicate source key trong batch va key da co trong cung DataSource deu reject; cung key o DataSource version khac duoc phep. V1 khong implicit upsert/merge va khong persist partial error rows khi commit invalid.

### 18.5 Concurrency, database va evidence status

- Exercise create khoa `active admin actor User FOR SHARE → Lesson FOR UPDATE → Topic FOR UPDATE (neu co)` roi insert; mutation tren Exercise hien huu khoa tiep `LessonExercise FOR UPDATE`. Publish listening khoa `Media FOR SHARE` sau Exercise. Safety `Media UPDATE` doi SHARE lock ket thuc roi moi quarantine/soft-archive; public an Exercise sau do. Import lock `active admin actor User FOR SHARE → DataSource/Sorted Lesson/Sorted Topic FOR UPDATE`. Activity submit dung `User FOR UPDATE → Lesson/Topic/LessonExercise FOR SHARE → progress FOR UPDATE`; publish-vs-submit vi vay snapshot mot version coherent ke ca khi actor va learner la cung User.
- `npm run seed:learning` upsert stable Topic theo `(lessonId, orderIndex)` va update tai cho; khong delete/recreate Topic da duoc Exercise tham chieu.
- Migration forward-only: `20260811120000_exercise_authoring_import_validation_v1`. Preflight dung neu co published legacy Exercise, archive state ambiguous, parent archived/incoherent hoac LessonExercise revision dangling/null/blank hash; migration khong doan/backfill JSON/media provenance.
- Database backstop: Lesson/Topic/Media/DataSource FK `RESTRICT`, unique source key theo DataSource, Media URL nonempty/no-whitespace, publishedAt/archive-state/media-scope/revision-hash CHECK, listening/speaking publish trigger, live-parent trigger, revision-parent trigger va hard-delete rejection. Persistence `P2003`/`23503`/`P2004`/`23514` map thanh safe HTTP `409`. Revision/review/publish recheck parent live; archive van duoc phep de cleanup child khi parent da archive.
- Feature-specific SQL acceptance chay rollback qua `npm run test:db:exercise-integrity`. Production-path concurrency runner hien co 7 race: concurrent revisions, concurrent publish, publish/archive, publish/submit distinct-user, publish/submit same-actor, archive/submit va import idempotency. Race chi GREEN khi B duoc quan sat o PostgreSQL Lock truoc release A va final invariant dung.
- Evidence artifact frozen `74944a7d95fabc02a0e84fe39b91543ac41a63e4714cfcaf389e81fe432d9f7c`: deploy du 15 migration, migrate status va migration-history shadow/live drift deu pass; inventory 57 table/143 FK/78 CHECK/33 trigger. P0/Activity/Exercise SQL integrity deu PASS + rollback sach. P0 concurrency `3/3`, CMS `4/4`, Activity `5/5`, Exercise `7/7`; moi Exercise race quan sat B o PostgreSQL Lock truoc release va xac minh response/domain/final invariant. Full E2E `8/8` suite, `118/118` test; static gate Prisma/TypeScript/build/lint/format/unit deu GREEN. Negative preflight Media URL whitespace tra P0001 va rollback atomic; Exercise runner rerun tren DB da co fixture bi fresh-only preflight tu choi dung contract.

Decision rationale va rollback boundary: `docs/adr/ADR-002-EXERCISE-AUTHORING-VERSION-MEDIA-IMPORT-ATOMICITY.md`.

## 19. Frontend Platform Foundation, Secure Admin Session & Exercise Read Console V1 — 11/08/2026

- Frontend runtime nam tai `frontend/`, dung Next.js 16.3 App Router, React 19,
  TypeScript 6 strict va npm service-local lockfile. Server Components la mac dinh;
  client components chi danh cho login/logout va interaction can browser.
- Session browser dung BFF same-origin. `POST /api/session/login` validate Origin,
  input va backend response, chi dat token vao cookie `HttpOnly`, `SameSite=Lax`,
  `Secure` production, `Path=/`; `Max-Age` lay tu JWT `exp`. Response khong tra token.
- Protected admin layout doc cookie server-side va goi `/api/v1/auth/me`; current
  database role/account state la authority. Session invalid duoc clear va redirect
  login; non-admin den `/forbidden` truoc khi render admin data.
- Backend client co fixed server-only origin, explicit path allowlist, `no-store`,
  timeout 8 giay mac dinh, request ID va safe error classification. BFF khong phai
  generic proxy; browser storage khong chua credential.
- UI `HSK Content Workbench` gom login, navy/jade/rice admin shell, URL-driven
  Exercise filters/pagination, mobile record layout va Exercise detail voi canonical
  content, admin-only answer, Lesson/Topic, provenance, safe Media va revision/review
  history. Status dung text + marker, khong chi dung mau.
- Backend Exercise admin read projection duoc mo rong read-only voi safe
  `lesson`, `topic`, `dataSource`; khong thay schema/migration hay mutation contract.
  BFF list loai `answer`; answer chi xuat hien trong protected server-rendered detail.
- Security headers co CSP, frame deny, MIME sniffing deny, referrer va permissions
  policy; HSTS chi o production. Logout V1 xoa frontend cookie, chua revoke token o
  backend do refresh/session runtime chua co.
- Test-first evidence: RED 9 suite do production modules chua ton tai; GREEN
  11/11 suite, 46/46 unit/component/integration. Production build/typecheck/lint va
  npm production audit (0 vulnerability) pass. Playwright qua NestJS that va database
  disposable 15 migration: 12/12 tren Chromium desktop 1440/mobile 390/tablet 768,
  bao gom deep link, HttpOnly persistence, RBAC, URL filters, detail, logout,
  keyboard, no-overflow, console error va axe.
- `backend/scripts/test/seed-frontend-admin-console.ts` chi seed mot lan tren fresh
  disposable DB; guard cho phep migration-owned DataSource nhung yeu cau cac bang
  mutable cua fixture rong, khong truncate/reset/delete.
- Explicit exclusion cua Exercise console: khong co create/review/publish/archive/
  import UI. Media navigation hien da hoat dong theo V1 inventory/detail/quarantine/
  soft archive. Secure ingestion/private binary delivery API V1 da co o muc 21;
  upload UI va async variant/transcode van la backlog rieng.

Quyet dinh: `docs/adr/ADR-003-FRONTEND-FOUNDATION-ADMIN-SESSION-BFF.md`.

## 20. Media Asset Operations API & Admin Library V1 — 12/08/2026

- V1 dung schema `Media` hien co; khong migration. Backend co admin list/detail,
  filter/pagination, provenance/reference va idempotent quarantine/soft archive.
- Safe projection khong tra `url`, `storageProvider`, `storageKey`, checksum hay raw
  metadata. Filename chi la bounded NFKC basename sau khi bo path/control character.
- Lifecycle lock `active admin User FOR SHARE → Media FOR UPDATE`; DB role duoc
  recheck trong transaction. Concurrent retry hoi tu mot transition va mot safe
  `AuditLog`; quarantine asset archived tra conflict, khong hard-delete/restore.
- Frontend co `/admin/media`, `/admin/media/:mediaId` va fixed allowlisted same-origin
  BFF. Filters/pagination nam trong URL; desktop dung semantic table, tablet/mobile
  dung labelled record list. UI theo `06-admin-cms-operations.png` va AdminShell
  navy/jade hien co, khong render action gia.
- Tai thoi diem ADR-004, upload/ingestion la explicit non-goal va chua co shared
  private object storage. ADR-005/muc 21 da bo sung secure ingestion + private
  delivery API; Admin Library upload UI van la backlog. Local filesystem van bi cam
  vi runtime phai stateless de scale ngang.
- Public listening visibility tiep tuc la consumer authority: Media mat ready/live
  se an Exercise moi, con immutable attempt snapshot cu duoc giu theo ADR-002.

Quyet dinh: `docs/adr/ADR-004-MEDIA-ASSET-OPERATIONS-AND-ADMIN-LIBRARY.md`.

## 21. Secure Media Ingestion, Object Storage & Processing V1 — 12/08/2026

- Admin API upload mot JPEG/PNG/MP3/WAV toi da 10 MiB, bat buoc JWT admin hien
  hanh, `DataSource` co license va `Idempotency-Key`. PostgreSQL rate limit
  5 request/admin/phut de giu behavior nhat quan khi scale ngang.
- Filename chi la NFKC bounded metadata; traversal/separator/control/bidi/encoded
  separator bi reject. Object key dung UUID opaque, khong dung filename va khong
  lo qua response/audit.
- Anh duoc Sharp decode/re-encode voi 40M pixel cap; WAV parse container/chunk/PCM;
  MP3 parse metadata. SVG/HTML/PDF/video/executable, MIME/signature mismatch,
  malformed/truncated, double extension va audio polyglot bi reject.
- Production storage la S3-compatible private adapter, AES256/checksum metadata,
  8s timeout va actual-byte streamed read cap 10 MiB, khong tin rieng ContentLength;
  test adapter chi active o `NODE_ENV=test`. ClamAV INSTREAM scan fail-closed voi
  10s timeout va chi chap nhan exact NUL-terminated OK/FOUND response; khong danh dau
  ready truoc scan va object write.
- `MediaIngestion` state la pending/processing/completed/rejected/failed/
  cleanup_required. Unknown PUT outcome khong auto-delete vi provider co the commit
  muon; tracked key giu cleanup_required cho explicit reconciliation/admin cleanup.
  Deterministic finalize failure co token-fenced delete compensation; delete khong
  xac nhan duoc van giu cleanup_required. History/identity/terminal
  state va completed↔Media coherence co SQL trigger/backstop.
- Moi attempt co random `processingToken`; moi side effect fence theo token. V1 bo
  automatic stale takeover theo application timestamp; processing retry tra 409 va
  recovery la incident procedure: quiesce worker, reconcile tracked object, row-lock
  va chuyen co chu dich sang cleanup_required/failed truoc cleanup/retry. Stale loser
  khong the finalize/xoa object winner.
- Claim/reject/finalize/cleanup xu ly transaction commit-ack bi mat bang request-owned
  token va authoritative reread; outcome khong doc duoc tra safe 503, khong doan va
  khong lap object side effect/audit.
- Exact retry bind actor/source/filename/MIME/raw size/raw SHA-256 bang hash.
  Completed replay re-read object va Media de verify checksum bytes, size, MIME,
  provenance/storage identity. Concurrency serialize actor SHARE → licensed source
  SHARE → ingestion UPDATE; network IO nam ngoai transaction.
- Signed access la same-origin capability HMAC 60–600s. Access grant can JWT;
  admin hoac learner co published Exercise reference moi duoc cap; content read
  revalidate expiry, ready/live state, MIME/size/checksum va bytes.
- Signed content dung `Cache-Control: private, no-store`; reverse proxy/CDN cam cache
  va access log phai redact signature/full signed query URL.
- UI not in scope: Admin Library khong tu dong them upload button. Upload UI,
  PDF/video, thumbnail/variant va async job/worker la backlog ro rang.

Quyet dinh: `docs/adr/ADR-005-SECURE-MEDIA-INGESTION-OBJECT-STORAGE-PROCESSING.md`.

Closeout evidence `2026-08-12`: migration 16 SHA-256
`a5bb8bdd6f8408b3360fe987e8d4fb7bf15f22c94f84e3fdac03dc4e93ebfe2e`; fresh
deploy/status/SQL/drift GREEN, fencing `10/10`, Media E2E `20/20`, full backend E2E
`11/11` suite (`155/155` test), unit `40/40` suite (`393/393` test), targeted
security/adapter contract `8/8` suite (`58/58` test), production
dependency audit 0 vulnerability. Day la PASS cho code commit, khong phai production
release: live S3/ClamAV rehearsal, bucket policy/retention va proxy access-log
redaction van do Infra/Release hoan tat truoc beta.

## 22. Media post-commit integrity & release controls — 13/08/2026

- Forward migration 17 giu migration 16 bat bien, snapshot DataSource
  code/version/license/attribution/referenceUrl/contentHash vao MediaIngestion va
  guard parent mutation. Correction provenance tao DataSource version moi; completed
  history khong phu thuoc metadata parent co the sua.
- V1 exact single-provider: Media access, signed read, completed replay, retry cleanup
  va write retry fail-closed truoc storage I/O neu stored provider khac adapter.
- Unknown PUT khong bao clean sau mot DELETE. Reconciliation HEAD/DELETE/HEAD, ghi
  observation absence dau, doi toi thieu 60 giay, recheck; late commit duoc xoa va
  reset window. Key ambiguous/da cleanup khong reuse, history khong hard-delete.
- Upload kill switch `MEDIA_INGESTION_ENABLED` mac dinh false ngoai test; cleanup,
  metrics va signed read tiep tuc cho forward recovery. Metrics endpoint private dung
  bearer secret va label enum bounded; khong label media/object/file/user/signature.
- Dashboard/alerts/Nginx query-redaction snippet/runbook o `ops/observability`,
  `ops/nginx` va `docs/operations`. Local deterministic gate khong thay the live
  S3/ClamAV/proxy/alert delivery; thieu ha tang that thi production release la
  BLOCKED_EXTERNAL.
- Migration 17 frozen SHA-256:
  `e333c0b0f265138e7c9ba16d17fc77d9586933bdd21ba70fda33f6fffe515773`;
  migration 16 van byte-identical tai `a5bb8bdd...fe2e`. Hai database disposable moi
  deploy du 17 migration; SQL integrity PASS va ROLLBACK ve 0 ingestion, ca hai drift
  check rong. Inventory: 60 table, 147 FK, 512 catalog CHECK row, 61 trigger-event
  row. Full E2E 11 suite/160 test va unit 45 suite/411 test deu PASS; dependency audit
  production co 0 vulnerability.
- Preflight migration 17 da rehearse ca fail va success: completed row thieu exact
  immutable provenance audit va source license whitespace deu dung fail-safe truoc
  DDL; exact six-field audit marker cho synthetic fixture cho phep backfill snapshot.
  Day chi la deterministic migration evidence. Live S3, ClamAV, reverse proxy va
  alert delivery chua co endpoint/credential that, nen release van
  `BLOCKED_EXTERNAL`.
