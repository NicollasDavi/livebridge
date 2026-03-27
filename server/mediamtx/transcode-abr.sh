#!/bin/sh
# Gera 3 RTMP derivados (1080p, 720p, 480p) a partir da publicação principal em $MTX_PATH.
# Bitrates devem coincidir com LIVE_ABR_* em server/api/server.js (playlist master).
# Requer imagem bluenviron/mediamtx:*-ffmpeg.

set -e
INPUT="rtmp://127.0.0.1:1935/${MTX_PATH}"
OUT108="${MTX_PATH}_1080"
OUT720="${MTX_PATH}_720"
OUT480="${MTX_PATH}_480"

exec ffmpeg -hide_banner -loglevel warning \
  -i "$INPUT" \
  -filter_complex "[0:v]split=3[v0][v1][v2];[v0]scale=-2:1080[vout0];[v1]scale=-2:720[vout1];[v2]scale=-2:480[vout2]" \
  -map "[vout0]" -map "0:a?" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -b:v 4500k -maxrate 4500k -bufsize 9000k \
  -force_key_frames "expr:gte(t,n_forced*1)" \
  -c:a aac -b:a 128k -ar 44100 \
  -max_muxing_queue_size 1024 \
  -f flv "rtmp://127.0.0.1:1935/${OUT108}" \
  -map "[vout1]" -map "0:a?" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -b:v 2800k -maxrate 2800k -bufsize 5600k \
  -force_key_frames "expr:gte(t,n_forced*1)" \
  -c:a aac -b:a 128k -ar 44100 \
  -max_muxing_queue_size 1024 \
  -f flv "rtmp://127.0.0.1:1935/${OUT720}" \
  -map "[vout2]" -map "0:a?" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -b:v 1200k -maxrate 1200k -bufsize 2400k \
  -force_key_frames "expr:gte(t,n_forced*1)" \
  -c:a aac -b:a 128k -ar 44100 \
  -max_muxing_queue_size 1024 \
  -f flv "rtmp://127.0.0.1:1935/${OUT480}"
