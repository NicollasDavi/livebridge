#!/bin/sh
# Diagnóstico RTMP - rode no servidor
# Se OBS falhar com "conexão expirou": libere porta 1935 (TCP) no Firewall do hPanel Hostinger

echo "=== Containers ==="
docker ps -a | grep -E "mediamtx|livebridge"

echo ""
echo "=== Porta 1935 ==="
ss -tlnp | grep 1935 || netstat -tlnp 2>/dev/null | grep 1935

echo ""
echo "=== Logs MediaMTX (últimas 20 linhas) ==="
docker logs livebridge-mediamtx --tail 20 2>&1

echo ""
echo "=== UFW (firewall) ==="
ufw status 2>/dev/null || echo "UFW não instalado ou sem permissão"
