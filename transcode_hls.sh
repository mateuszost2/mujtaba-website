#!/bin/bash
set -e

INPUT="$1"
[ -z "$INPUT" ] && { echo "Usage: $0 <input_video>"; exit 1; }
[ ! -f "$INPUT" ] && { echo "File not found: $INPUT"; exit 1; }

VIDEO_DIR=$(dirname "$INPUT")
ORIG_NAME=$(basename "${INPUT%.*}")

# Sanitize: match generate_manifest.py logic (lowercase, spaces/dashes → underscore)
BASENAME=$(echo "$ORIG_NAME" | tr '[:upper:]' '[:lower:]' | tr ' -' '_' | tr -cd 'a-z0-9_' | sed 's/__*/_/g' | sed 's/^_//;s/_$//')

HLS_DIR="$VIDEO_DIR/hls/$BASENAME"
mkdir -p "$HLS_DIR"

# Get source height to avoid upscaling
SRC_HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$INPUT" 2>/dev/null | head -1)
SRC_HEIGHT=${SRC_HEIGHT:-1080}
echo "[transcode] $INPUT — source: ${SRC_HEIGHT}p — output: $HLS_DIR"

encode() {
  local H=$1 BV=$2 MR=$3 BS=$4
  [ "$SRC_HEIGHT" -lt "$H" ] && return 0
  echo "[transcode] Encoding ${H}p..."
  ffmpeg -i "$INPUT" -y \
    -map 0:v:0 -map 0:a? \
    -c:v libx264 -preset fast \
    -c:a aac -ar 48000 -ac 2 \
    -vf "scale=-2:${H}" \
    -b:v "${BV}k" -maxrate "${MR}k" -bufsize "${BS}k" \
    -hls_time 6 -hls_list_size 0 \
    -hls_segment_filename "$HLS_DIR/${BASENAME}_${H}p_%04d.ts" \
    "$HLS_DIR/${BASENAME}_${H}p.m3u8" 2>&1
  echo "[transcode] ${H}p done."
}

encode 1080 3000 3500 6000
encode 720  1500 2000 3000
encode 480  600  800  1200

# Master playlist
PLAYLIST="$HLS_DIR/$BASENAME.m3u8"
printf '#EXTM3U\n#EXT-X-VERSION:3\n' > "$PLAYLIST"
[ "$SRC_HEIGHT" -ge 1080 ] && printf '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n%s_1080p.m3u8\n' "$BASENAME" >> "$PLAYLIST"
[ "$SRC_HEIGHT" -ge 720  ] && printf '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720\n%s_720p.m3u8\n'  "$BASENAME" >> "$PLAYLIST"
printf '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=854x480\n%s_480p.m3u8\n' "$BASENAME" >> "$PLAYLIST"

echo "[transcode] Done: $PLAYLIST"
