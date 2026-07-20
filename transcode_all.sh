#!/bin/bash
# Run once to transcode all existing videos to HLS.
# Safe to re-run — skips files that already have HLS.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRANSCODE="$SCRIPT_DIR/transcode_hls.sh"
LOG="$SCRIPT_DIR/transcode.log"

VIDEO_FOLDERS=(
  "videos/documentaries"
  "videos/ngo_works"
  "videos/travel_films"
  "videos/main_video"
)

count=0
skip=0

for FOLDER in "${VIDEO_FOLDERS[@]}"; do
  DIR="$SCRIPT_DIR/$FOLDER"
  [ -d "$DIR" ] || continue
  for FILE in "$DIR"/*.mp4 "$DIR"/*.mov "$DIR"/*.webm; do
    [ -f "$FILE" ] || continue
    ORIG=$(basename "${FILE%.*}")
    BASENAME=$(echo "$ORIG" | tr '[:upper:]' '[:lower:]' | tr ' -' '_' | tr -cd 'a-z0-9_' | sed 's/__*/_/g' | sed 's/^_//;s/_$//')
    HLS="$DIR/hls/$BASENAME/$BASENAME.m3u8"
    if [ -f "$HLS" ]; then
      echo "[skip] $FILE (HLS already exists)"
      skip=$((skip + 1))
    else
      echo "[transcode] $FILE"
      bash "$TRANSCODE" "$FILE" >> "$LOG" 2>&1
      count=$((count + 1))
    fi
  done
done

echo ""
echo "Done. Transcoded: $count | Skipped (already HLS): $skip"
echo "Now run: python generate_manifest.py"
