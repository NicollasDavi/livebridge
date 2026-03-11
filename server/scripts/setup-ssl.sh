#!/bin/bash
# Configura SSL com Let's Encrypt para o LiveBridge
# Uso: ./setup-ssl.sh seu-dominio.com
# Requisitos: domínio apontando para o servidor, portas 80 e 443 liberadas

set -e
DOMAIN="${1:?Uso: $0 seu-dominio.com}"

cd "$(dirname "$0")/.."

echo "=== LiveBridge SSL Setup ==="
echo "Domínio: $DOMAIN"
echo ""

# 0. Garantir que nginx está rodando
echo "[1/4] Verificando nginx..."
docker compose up -d nginx

# 1. Obter certificados (nginx já serve /.well-known via volume certbot-www)
echo "[2/4] Obtendo certificados Let's Encrypt..."
docker compose run --rm certbot certonly \
  --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "admin@$DOMAIN" \
  --agree-tos \
  --non-interactive \
  --force-renewal

# 2. Atualizar nginx.conf com o domínio
echo "[3/4] Configurando nginx com SSL..."
sed "s/SEU_DOMINIO/$DOMAIN/g" player/nginx-with-ssl.conf > player/nginx.conf

# 3. Reiniciar nginx
echo "[4/4] Reiniciando nginx..."
docker compose restart nginx

echo ""
echo "=== Concluído ==="
echo "Acesse: https://$DOMAIN"
echo ""
echo "Para renovar automaticamente, adicione ao crontab:"
echo "0 0 1 * * cd $(pwd) && docker compose run --rm certbot renew && docker compose restart nginx"
