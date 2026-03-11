#!/bin/bash
# Gera certificado autoassinado para HTTPS local
# O navegador mostrará aviso — aceite para continuar

cd "$(dirname "$0")/.."
mkdir -p certs

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -subj "/CN=localhost/O=LiveBridge"

echo "Certificado gerado em server/certs/"
echo "Reinicie o nginx: docker compose restart nginx"
