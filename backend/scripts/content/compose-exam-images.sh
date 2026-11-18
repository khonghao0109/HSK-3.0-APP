#!/usr/bin/env bash
# Ghép tranh lẻ của đề thi thành ảnh ghép có nhãn A/B/C… (PO 18/11/2026, Q350).
# AI không vẽ chữ; nhãn do script vẽ. Ô bằng nhau, nền giấy kem, nhãn tròn navy.
#   bash scripts/content/compose-exam-images.sh [raw_dir] [out_dir]
# Cần ImageMagick 7 (`magick`). Đọc danh sách ảnh từ content/hsk1/exam/mock-01.json.
set -euo pipefail
cd "$(dirname "$0")/../.."
RAW="${1:-$HOME/hsk-media/hsk1-slice/images/raw}"
OUT="${2:-$HOME/hsk-media/hsk1-slice/images}"
FONT="${LABEL_FONT:-/System/Library/Fonts/Supplemental/Arial Bold.ttf}"
TILE=512 GAP=16 BG='#FBF7EF' NAVY='#0D3152'
mkdir -p "$OUT"
node -e '
const m=require("./content/hsk1/exam/mock-01.json");
for (const i of m.images) console.log(i.key, i.panels.map(p=>p.label).join(""));
' | while read -r key labels; do
  tiles=()
  for ((i = 0; i < ${#labels}; i++)); do
    label="${labels:i:1}"
    src="$RAW/$key-$label.png"
    [[ -f "$src" ]] || { echo "thiếu $src" >&2; exit 1; }
    tile="$(mktemp -t tile).png"
    magick "$src" -resize "${TILE}x${TILE}^" -gravity center -extent "${TILE}x${TILE}" \
      -fill "$NAVY" -draw "circle 44,44 44,12" \
      -fill white -font "$FONT" -pointsize 40 -gravity NorthWest -annotate +31+21 "$label" \
      "$tile"
    tiles+=("$tile")
  done
  cols=3
  magick montage "${tiles[@]}" -tile "${cols}x" -geometry "${TILE}x${TILE}+$((GAP / 2))+$((GAP / 2))" \
    -background "$BG" "$OUT/$key.png"
  rm -f "${tiles[@]}"
  echo "$OUT/$key.png"
done
