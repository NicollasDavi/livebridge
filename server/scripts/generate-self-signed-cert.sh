#!/bin/bash
# Gera certificado autoassinado para HTTPS com Subject Alternative Name (SAN).
# Uso:
#   ./scripts/generate-self-signed-cert.sh
#       → SAN: DNS:localhost (desenvolvimento)
#   ./scripts/generate-self-signed-cert.sh 34.69.40.106
#       → SAN: IP do servidor + localhost (clientes Java/Python que ligam por HTTPS ao IP)
#   ./scripts/generate-self-signed-cert.sh 34.69.40.106 live.exemplo.com
#       → SAN: IP + localhost + domínio extra
#
# O nginx monta server/certs/fullchain.pem e privkey.pem (ver nginx/nginx.conf).

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs

PUBLIC_IP="${1:-}"
EXTRA_DNS="${2:-}"

# CN não substitui SAN; para cliente por IP o importante é IP em alt_names.
CN="LiveBridge"

TMP_CFG="certs/openssl-san.cnf.$$"
cleanup() { rm -f "${TMP_CFG}"; }
trap cleanup EXIT

{
  echo "[req]"
  echo "default_bits = 2048"
  echo "prompt = no"
  echo "default_md = sha256"
  echo "distinguished_name = dn"
  echo "req_extensions = v3_req"
  echo ""
  echo "[dn]"
  echo "CN = ${CN}"
  echo "O = LiveBridge"
  echo ""
  echo "[v3_req]"
  echo "basicConstraints = CA:FALSE"
  echo "keyUsage = digitalSignature, keyEncipherment"
  echo "extendedKeyUsage = serverAuth"
  echo "subjectAltName = @alt_names"
  echo ""
  echo "[alt_names]"
  dns_idx=1
  if [[ -n "${PUBLIC_IP}" ]]; then
    echo "IP.1 = ${PUBLIC_IP}"
  fi
  echo "DNS.${dns_idx} = localhost"
  dns_idx=$((dns_idx + 1))
  if [[ -n "${EXTRA_DNS}" ]]; then
    echo "DNS.${dns_idx} = ${EXTRA_DNS}"
  fi
} > "${TMP_CFG}"

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -config "${TMP_CFG}" \
  -extensions v3_req

chmod 600 certs/privkey.pem
chmod 644 certs/fullchain.pem

echo ""
echo "Certificado gerado em server/certs/fullchain.pem (+ privkey.pem)"
echo "Confirma SAN: openssl x509 -in certs/fullchain.pem -noout -text | grep -A2 'Subject Alternative Name'"
echo "Reinicia o nginx: docker compose -f docker-compose.yml restart nginx"
