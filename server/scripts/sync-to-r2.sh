#!/bin/sh
# Sincroniza gravações para Cloudflare R2
# Variáveis: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
BUCKET="${R2_BUCKET:-livebridge}"

rclone move /recordings "r2:${BUCKET}/recordings/" \
  --config /rclone/rclone.conf \
  --delete-empty-src-dirs \
  --min-age 30s \
  -v
