---
name: docker-containers
description: "Xây Docker image nhỏ, reproducible và hardened cho HSK services. Sử dụng khi tạo/chỉnh Dockerfile, Compose, runtime image hoặc container security."
---

# Docker & Containers

1. Multi-stage build, pinned base digest, lockfile install và build deterministic; copy runtime artifact tối thiểu.
2. Run non-root, read-only filesystem khi khả thi, drop capabilities, no privileged/host socket, temp volume bounded.
3. Không bake secret/dev dependency/source map nhạy cảm; `.dockerignore` chặt, SBOM + vulnerability/license scan.
4. Health/readiness riêng; PID1 signal, graceful shutdown, timeout và resource request/limit.
5. Logs stdout structured; state/upload ngoài container; immutable tag bằng digest/version.
6. Compose local mô phỏng dependency/health/network nhưng không chứa production credential.
7. Test build, start, health, signal drain, filesystem permission, scan và multi-arch nếu cần.

**Gate:** critical CVE policy, reproducible checksum/provenance, image size/bloat review và runtime compatible nhiều replica.
