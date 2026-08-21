---
name: search-dictionary
description: "Xây dictionary/search tiếng Trung chính xác và hiệu năng cao. Sử dụng khi import Word, normalize Hanzi/pinyin, thêm search/filter/detail hoặc tối ưu index."
---

# Search & Dictionary

1. Dùng shared canonical normalization cho import/seed/query: Unicode, case, whitespace và pinyin tone/normalized forms.
2. Public chỉ trả `published` và chưa deleted, source/license hợp lệ; select safe fields và bounded pagination.
3. Chốt exact/prefix/fuzzy/ranking, locale và tie-break deterministic; protect expensive wildcard query.
4. Thiết kế index từ EXPLAIN trên corpus đại diện; partial public index, trigram/full-text chỉ khi benchmark chứng minh.
5. Import provenance/version/hash/idempotency; duplicate policy deterministic và atomic.
6. Cache public query theo canonical key/version; invalidate publish/archive.
7. Test simplified/traditional, tone/no-tone, Unicode collision, long query, empty result và explain budget.

**Gate:** relevance golden set đạt threshold, P95 latency/capacity được đo, không draft/deleted/private data leak.
