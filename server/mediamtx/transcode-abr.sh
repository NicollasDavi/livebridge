#!/bin/sh
# Gera 2 RTMP derivados (720p, 480p) a partir da publicação principal em $MTX_PATH.
# O rung de maior qualidade ("Fonte") é servido direto do ingest do OBS, sem reencode
# (ver playlist master em server/api/routes/live.js). Antes eram 3 encodes x264 em paralelo;
# ao deixar o topo passthrough sobra CPU para um preset melhor + B-frames nas 2 saídas.
# Bitrates devem coincidir com LIVE_ABR_* em server/api/config.js (playlist master).
# Requer imagem bluenviron/mediamtx:*-ffmpeg.

set -e
INPUT="rtmp://127.0.0.1:1935/${MTX_PATH}"
OUT720="${MTX_PATH}_720"
OUT480="${MTX_PATH}_480"
# Só 2 encodes agora → headroom de CPU. veryfast com B-frames bate folgado o superfast+zerolatency em qualidade.
PRESET="${TRANSCODE_PRESET:-veryfast}"
# Alinhar GOP à duração do segmento HLS (mediamtx hlsSegmentDuration) — cortes limpos nos .ts e troca de qualidade ABR.
HLS_GOP_SEC="${HLS_GOP_SEC:-4}"
# Fila na entrada RTMP: quanto maior, mais margem antes de "reader is too slow".
THREAD_Q="${FFMPEG_THREAD_QUEUE_SIZE:-4096}"
# Sem zerolatency: como a entrega é HLS por segmentos (não LL), B-frames e múltiplas refs
# melhoram muito a qualidade no mesmo bitrate. Voltar ao antigo: X264_LIVE_OPTS="-tune zerolatency -bf 0 -refs 1"
X264_LIVE_OPTS=${X264_LIVE_OPTS:-"-bf 2 -refs 3"}

exec ffmpeg -hide_banner -loglevel warning \
  -thread_queue_size "$THREAD_Q" \
  -i "$INPUT" \
  -filter_complex "[0:v]split=2[v1][v2];[v1]scale=-2:720[vout1];[v2]scale=-2:480[vout2]" \
  -map "[vout1]" -map "0:a?" \
  -c:v libx264 -preset "$PRESET" -pix_fmt yuv420p $X264_LIVE_OPTS \
  -b:v 2800k -maxrate 2800k -bufsize 5600k \
  -force_key_frames "expr:gte(t,n_forced*${HLS_GOP_SEC})" \
  -c:a aac -b:a 128k -ar 48000 \
  -max_muxing_queue_size 4096 \
  -f flv "rtmp://127.0.0.1:1935/${OUT720}" \
  -map "[vout2]" -map "0:a?" \
  -c:v libx264 -preset "$PRESET" -pix_fmt yuv420p $X264_LIVE_OPTS \
  -b:v 1200k -maxrate 1200k -bufsize 2400k \
  -force_key_frames "expr:gte(t,n_forced*${HLS_GOP_SEC})" \
  -c:a aac -b:a 128k -ar 48000 \
  -max_muxing_queue_size 4096 \
  -f flv "rtmp://127.0.0.1:1935/${OUT480}"
