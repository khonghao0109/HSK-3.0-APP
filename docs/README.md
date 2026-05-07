# HSK 3.0 APP

Nen tang on thi HSK 1-9 (phien ban 3.0), huong toi production voi kien truc tach ro `frontend + backend + ai`.

## Muc tieu du an

- Ho tro nguoi hoc on luyen HSK theo cap do.
- Cung cap luong hoc tu kien thuc den thi thu va xem ket qua.
- Quan tri noi dung va bao cao qua trang admin.
- Tich hop tro ly AI (RAG) de giai thich tu vung, ngu phap, bai hoc.

## Kien truc tong quan

```text
hsk-system/
  frontend/   # giao dien user + admin
  backend/    # core API (NestJS + Prisma + PostgreSQL)
  ai/         # RAG/embeddings service doc lap
  docs/       # tai lieu du an (API, roadmap, context cho AI)
```

## Chuc nang chinh

- Nguoi dung:
  - Dang ky, dang nhap.
  - Hoc theo level/bai hoc/chu de/cau chuyen.
  - Lam bai thi, nop bai, xem ket qua.
  - Theo doi tien do hoc va lich su.
- Admin:
  - Quan ly nguoi dung.
  - Quan ly noi dung hoc, de thi, tai lieu.
  - Xem thong ke va bao cao.
- AI:
  - Tra cuu kien thuc theo ngu canh hoc.
  - Ho tro giai thich va goi y hoc tap.

## Cong nghe su dung

- Backend: `NestJS`, `Prisma`, `PostgreSQL`, `Jest`
- Frontend: bo khung app router + feature-based structure
- AI: `rag-api` service + pipelines (`dictionary`, `embeddings`, `materials`)
- DevOps target: Docker, Nginx, Redis, Cloud storage (S3/Cloudinary)

## Data pipeline

Dictionary pipeline tai `backend/scripts/dictionary/`:

1. `raw/` -> `parse.ts`
2. `parsed/` -> `normalize.ts`
3. `normalized/` -> `seed.ts` -> database

## Tai lieu quan trong

- API spec: `docs/api.md`
- Product roadmap: `docs/roadmap.md`
- Full AI project context: `docs/PROJECT_CONTEXT_FOR_AI.md`

## Quick start

### 1) Clone source

```bash
git clone https://github.com/khonghao0109/HSK-3.0-APP.git
cd HSK-3.0-APP
```

### 2) Backend

```bash
cd backend
npm install
npm run start:dev
```

Backend mac dinh chay tai `http://localhost:3000/api/v1`.

### 3) Environment

- Copy `.env.example` thanh `.env` cho tung service (`backend`, `frontend`, `ai`).
- Dien bien moi truong bat buoc (DB, JWT, API keys).

## Trang thai hien tai

- Da hoan thien bo khung kien truc production-grade.
- Da co Prisma schema + migrations ban dau.
- Da co docs API/roadmap/context.
- Dang tiep tuc hoan thien business modules va UI.

## Dinh huong tiep theo

1. Hoan thien Auth + Users + Learning modules.
2. Hoan thien Exam flow (question/test/result + submit scoring).
3. Hoan thien Materials + Admin dashboard.
4. Tich hop AI chat gateway va RAG service.

---

Neu ban la dev/AI agent moi, hay doc `docs/PROJECT_CONTEXT_FOR_AI.md` truoc khi code.
