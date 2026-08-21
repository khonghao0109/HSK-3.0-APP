---
name: git-workflow
description: "Thực hiện Git workflow an toàn, reviewable và truy vết được. Sử dụng khi bắt đầu task, chia commit, resolve conflict, stage/commit hoặc chuẩn bị PR/release."
---

# Git Workflow

1. Baseline `git status`, branch, staged/unstaged/untracked; coi thay đổi có sẵn là tài sản người dùng.
2. Không reset/clean/checkout/destructive history nếu chưa được yêu cầu rõ; tránh chạm file ngoài scope.
3. Review là read-only và không tự cấp quyền stage/commit. Thay đổi nhỏ theo vertical slice khi implementation được phép.
4. Trước stage được ủy quyền: review full diff, generated/binary/secret/env/fixture; `git diff --check`.
5. Chỉ stage explicit paths khi được ủy quyền; review `--cached` name/status/diff/secret/focused test và `git diff --cached --check`.
6. Commit cần authorization riêng hoặc prompt nêu rõ; amend, rebase và push luôn cần authorization phù hợp. Không commit nếu required gate RED.
7. Sau commit ghi hash/message/status và pre-existing dirty state.

**Gate:** commit reproducible, không unrelated/secret, migration checksum/staged bytes đúng và review history dễ hiểu.
