#!/usr/bin/env bash
# Pull deploy sem SSH de entrada: corre na VM (systemd timer / cron).
# 1) Lê manifesto no GCS (escrito pelo GitHub Actions)
# 2) git pull (HTTPS/outbound) para configs nginx/mediamtx
# 3) docker compose pull + up das imagens api/merge
#
# Env (ficheiro /etc/livebridge/pull-deploy.env ou export antes):
#   LIVEBRIDGE_DIR=/opt/livebridge
#   GCS_DEPLOY_URI=gs://SEU_BUCKET/livebridge/deploy-manifest.json
#   COMPOSE_FILES="-f docker-compose.yml"   # opcional + observability
set -euo pipefail

LIVEBRIDGE_DIR="${LIVEBRIDGE_DIR:-/opt/livebridge}"
GCS_DEPLOY_URI="${GCS_DEPLOY_URI:-}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml}"
STATE_DIR="${STATE_DIR:-/var/lib/livebridge}"
LOCK_FILE="${STATE_DIR}/pull-deploy.lock"
LAST_SHA_FILE="${STATE_DIR}/last-deploy-sha"

if [ -z "$GCS_DEPLOY_URI" ]; then
  echo "[pull-deploy] GCS_DEPLOY_URI não definido" >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[pull-deploy] já em execução — a sair"
  exit 0
fi

TMP="$(mktemp)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

if command -v gcloud >/dev/null 2>&1; then
  gcloud storage cp "$GCS_DEPLOY_URI" "$TMP"
elif command -v gsutil >/dev/null 2>&1; then
  gsutil -q cp "$GCS_DEPLOY_URI" "$TMP"
else
  echo "[pull-deploy] instale gcloud ou gsutil na VM" >&2
  exit 1
fi

SHA="$(python3 -c "import json; print(json.load(open('$TMP'))['sha'])")"
API_IMAGE="$(python3 -c "import json; print(json.load(open('$TMP'))['apiImage'])")"
MERGE_IMAGE="$(python3 -c "import json; print(json.load(open('$TMP'))['mergeImage'])")"

if [ -z "$SHA" ] || [ -z "$API_IMAGE" ] || [ -z "$MERGE_IMAGE" ]; then
  echo "[pull-deploy] manifesto inválido" >&2
  exit 1
fi

PREV=""
if [ -f "$LAST_SHA_FILE" ]; then
  PREV="$(cat "$LAST_SHA_FILE")"
fi

if [ "$PREV" = "$SHA" ]; then
  echo "[pull-deploy] já em $SHA — nada a fazer"
  exit 0
fi

echo "[pull-deploy] a atualizar $PREV → $SHA"

cd "$LIVEBRIDGE_DIR"
git fetch origin
git checkout main
git pull --ff-only origin main

cd "$LIVEBRIDGE_DIR/server"

# Imagens do manifesto (não rebuild local)
export API_IMAGE
export MERGE_IMAGE

# shellcheck disable=SC2086
docker compose $COMPOSE_FILES pull api merge
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d

echo "$SHA" > "$LAST_SHA_FILE"
echo "[pull-deploy] OK — api=$API_IMAGE merge=$MERGE_IMAGE"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES ps
