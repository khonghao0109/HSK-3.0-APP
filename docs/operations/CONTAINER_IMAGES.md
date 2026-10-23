# Container Images (M1.8, ADR-008 §11)

Hai image production build từ `backend/Dockerfile` và `frontend/Dockerfile`:
multi-stage, cùng base `node:24-bookworm-slim` pin theo digest (`@sha256:`,
xem dòng `FROM` trong từng Dockerfile), chạy bằng user `node` (uid 1000,
không phải root), cài dependencies bằng `npm ci --ignore-scripts` từ lockfile.
Không có `.env*` trong build context hay image (`.dockerignore` chặn, kể cả
`.env.example`). Migrate **không** tự chạy khi container start.

## Build

```bash
docker build -t hsk-backend:<tag> backend/
docker build -t hsk-frontend:<tag> frontend/
```

CI (job `images` trong `.github/workflows/ci.yml`) build cả hai trên
linux/amd64, kiểm `id -u` ≠ 0 và ghi image ID vào job summary.

## Backend — một image, ba lệnh

```bash
# API (CMD mặc định)
docker run -d --name hsk-api <env...> hsk-backend:<tag>
# tương đương: node dist/src/main.js

# Worker (pg-boss)
docker run -d --name hsk-worker <env...> hsk-backend:<tag> node dist/src/worker.js

# Migrate — chạy riêng một lần, không phải lúc start API/worker
docker run --rm <env...> hsk-backend:<tag> node dist/scripts/operations/bounded-prisma-migrate-deploy.js
```

`<env...>` truyền qua orchestrator (Secrets Manager qua task role theo
ADR-008 §8), không qua file `.env` trong image.

## Frontend

```bash
docker run -d --name hsk-web -p 3000:3000 \
  -e BACKEND_API_URL=http://<api-container>:3000 \
  -e APP_ORIGIN=https://<origin-cong-khai> \
  hsk-frontend:<tag>
```

Image dùng Next `output: 'standalone'`: process là `node server.js`, đã gồm
`.next/static` và `public`. Lắng nghe `0.0.0.0:3000` (ENV `HOSTNAME`, `PORT`
cố định trong Dockerfile). Lưu ý: `next start` ngoài container in cảnh báo
khuyên dùng `node .next/standalone/server.js` nhưng vẫn serve bình thường
(Next 16.3.0 chỉ warn, không throw); Playwright e2e vẫn chạy qua `next start`.

## Env bắt buộc (chỉ tên biến; giá trị do môi trường chạy cấp)

Backend (định nghĩa ở `backend/src/config/env.validation.ts`; production bắt
buộc provider thật — `memory`/`test` chỉ hợp lệ khi `NODE_ENV=test`):

- `DATABASE_URL`, `JWT_SECRETS`, `JWT_ACTIVE_KID`, `AUTH_PASSWORD_PEPPER`
- `ALLOWED_ORIGINS`, `APP_PUBLIC_URL`
- `MAIL_PROVIDER` + `MAIL_FROM` (+ `MAIL_SES_REGION` khi `ses`)
- `MEDIA_STORAGE_PROVIDER` (+ `MEDIA_STORAGE_BUCKET`, `MEDIA_STORAGE_REGION` khi `s3`)
- `MEDIA_SCANNER_PROVIDER` (+ `MEDIA_SCANNER_HOST` khi `clamav`)
- `MEDIA_SIGNING_SECRET`, `MEDIA_METRICS_BEARER_TOKEN`, `MEDIA_METRICS_HOST`, `MEDIA_METRICS_PORT`
- `PORT` (mặc định 3000), `NODE_ENV=production` (đặt sẵn trong image)

Frontend (định nghĩa ở `frontend/src/lib/config/env-schema.ts`):

- `BACKEND_API_URL`, `APP_ORIGIN`
- Tuỳ chọn: `BFF_REQUEST_TIMEOUT_MS`, `SESSION_COOKIE_NAME`, `LEARNER_SESSION_COOKIE_NAME`

## Non-root

Cả hai image kết thúc bằng `USER node`. Kiểm chứng:

```bash
docker run --rm --entrypoint id hsk-backend:<tag> -u   # 1000
docker run --rm --entrypoint id hsk-frontend:<tag> -u  # 1000
```

## Image ID (immutable reference)

```bash
docker image inspect --format '{{.Id}}' hsk-backend:<tag>
docker image inspect --format '{{.Id}}' hsk-frontend:<tag>
```

CI job `images` ghi hai giá trị này vào `$GITHUB_STEP_SUMMARY` mỗi lần build.

## Giới hạn (chưa làm ở M1.8)

- Không push registry, không ký cosign, không SBOM/attestation — đó là M6.2
  (build-once/promote-many theo digest, ADR-008 §8).
- Không có `HEALTHCHECK`, không init (tini): đo hiện tại cả API, worker và
  frontend đều bắt SIGTERM và thoát sạch < 15s; xem lại nếu đo lại khác.
- Không thêm service app vào `docker-compose.yml` — đó là M6.1.
