# HSK 3.0 APP

Nền tảng học, ôn và thi HSK 1–9 (bảy nhóm curriculum `HSK1`…`HSK6`, `HSK7_9`).
Monorepo, mỗi service có `package.json` và `package-lock.json` riêng — không dùng
npm workspaces ở thời điểm này.

Trạng thái: **PRE-BETA**. Backend và admin console đã có nền; learner app và hạ tầng
production chưa có. Trạng thái từng bước ghi ở [docs/PLAN.md](./docs/PLAN.md).

## Thư mục

| Thư mục | Nội dung |
| --- | --- |
| `backend/` | NestJS 11 + Prisma 5 + PostgreSQL. API `/api/v1`. Module: `auth`, `cms`, `dictionary`, `health`, `learning`, `media`, `onboarding`, `user`. |
| `frontend/` | Next.js 16 App Router + React 19. Admin console; BFF server-only giữ token, browser không giữ bearer (ADR-003). CSS variables, không Tailwind (ADR-008). |
| `ai/` | Chỗ dành cho service RAG TypeScript tách riêng (`services/rag-api/`, ADR-008 §6). Hiện toàn file rỗng, chưa có runtime. Không đưa RAG logic vào `backend/`. |
| `ops/` | Cấu hình nginx và observability (Prometheus, Alertmanager, Grafana) cho Media. |
| `docs/` | Toàn bộ tài liệu: kế hoạch, roadmap, kiến trúc, API contract, ADR, database, vận hành. |

## Chạy nhanh

Cần Node theo [.nvmrc](./.nvmrc) (24 LTS) và PostgreSQL 16.

```bash
# Backend — http://localhost:3000/api/v1
cd backend && npm install && cp .env.example .env   # điền DATABASE_URL, JWT_SECRETS…
npm run start:dev

# Frontend — cần backend chạy ở BACKEND_API_URL
cd frontend && npm install && cp .env.example .env
npm run dev
```

Gate trước khi mở PR, chạy trong thư mục service bị ảnh hưởng:

```bash
cd backend  && npm run lint:check && npm run format:check && npm run build && npm test
cd frontend && npm run lint && npm run typecheck && npm test
```

## Tài liệu

Điểm vào duy nhất: **[docs/README.md](./docs/README.md)** — bản đồ tài liệu, thứ tự đọc
và quy tắc bảo trì. Tiến độ ở [docs/PLAN.md](./docs/PLAN.md); lệnh kiểm thử đầy đủ và
cách chạy e2e ở [docs/architecture/overview.md](./docs/architecture/overview.md).

Quy tắc làm việc cho người và AI agent: [AGENTS.md](./AGENTS.md).

## Giấy phép

Private, chưa cấp phép công khai (`UNLICENSED`).
