---
name: file-media-storage
description: "Thiết kế upload, media processing, object storage và Media lifecycle an toàn. Sử dụng cho audio/image/PDF/video, admin library, lesson media hoặc CDN/storage migration."
---

# File & Media Storage

1. Upload qua allowlist MIME + magic signature + size/duration/dimension; filename chỉ metadata, không path.
2. Ghi object private bằng random immutable key; checksum/dedup có scope; signed URL ngắn hạn khi cần.
3. Pipeline pending → processing → ready/failed/quarantined; scan/transcode async, idempotent, retry/DLQ và audit.
4. Public publish chỉ tham chiếu media ready/live/đúng type/URL hợp lệ; query public recheck visibility.
5. Không hard-delete asset có history/reference; archive/quarantine ẩn public nhưng snapshot lịch sử chỉ chứa safe projection.
6. Object/IAM encryption, CORS, lifecycle/retention, backup và CDN cache invalidation rõ.
7. Test polyglot/spoof/oversize, traversal, SSRF URL, concurrent quarantine/publish, broken object và accessibility caption.

**Gate:** no public raw bucket, no executable upload, provenance/license/audit đầy đủ, cost/egress/processing SLO observable.
