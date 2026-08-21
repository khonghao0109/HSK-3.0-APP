---
name: mobile-app-development
description: "Phát triển mobile app HSK production-ready theo ảnh mẫu, platform conventions và secure/offline architecture. Sử dụng khi tạo screen, navigation, native integration, audio/speech hoặc sync."
---

# Mobile App Development

1. Chọn stack theo ADR/spike; dùng feature modules, typed API/domain model và platform adapter.
2. Map screen tới ảnh mẫu; giữ visual identity nhưng tuân iOS/Android navigation, safe area, Dynamic Type và gesture.
3. Token trong Keychain/Keystore; TLS, deep-link allowlist, clipboard/screenshot risk và no secret log.
4. List/image/audio tối ưu memory/network; background/foreground/interruption và permission flow rõ.
5. Offline/sync idempotent, conflict visible; local schema migration/rollback và logout purge.
6. Accessibility labels/roles/focus/touch 44–48, reduced motion, orientation và screen reader.
7. Test unit/integration, device farm/real devices, slow/offline, low memory/storage, upgrade và crash telemetry.

**Gate:** crash-free/ANR/startup budgets, privacy declaration, screenshot visual QA và release readiness.
