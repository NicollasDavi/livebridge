# SSL / HTTPS

O LiveBridge usa HTTPS por padrão com **certificado autoassinado** (sem domínio necessário).

---

## Certificado autoassinado (padrão)

Já configurado. Acesse: **https://localhost:443** ou **https://IP-DO-SERVIDOR:443**

O navegador mostrará aviso de segurança (certificado não confiável) — clique em "Avançado" → "Continuar" para prosseguir.

**Regenerar certificado** (autoassinado, ~825 dias):

Sem SAN extra (só `localhost` — desenvolvimento):

```bash
cd server
chmod +x scripts/generate-self-signed-cert.sh
./scripts/generate-self-signed-cert.sh
docker compose restart nginx
```

Com **IP público no SAN** (obrigatório se clientes HTTPS ligam a `https://IP` — ex.: Java `HttpsURLConnection` / PKIX com verificação de hostname):

```bash
cd server
./scripts/generate-self-signed-cert.sh SEU_IP_PUBLICO
docker compose restart nginx
openssl x509 -in certs/fullchain.pem -noout -text | grep -A2 'Subject Alternative Name'
```

Deves ver `IP Address:SEU_IP_PUBLICO` e `DNS:localhost`. Volta a exportar o novo certificado para o truststore dos clientes que confiam no LiveBridge.

Opcional (IP + domínio extra no SAN):

```bash
./scripts/generate-self-signed-cert.sh SEU_IP_PUBLICO live.seudominio.com
```

---

## Let's Encrypt (com domínio)

Se você tem um domínio apontando para o servidor:

---

## Pré-requisitos (Let's Encrypt)

1. **Domínio** apontando para o IP do servidor (registro A ou CNAME)
2. **Portas 80 e 443** liberadas no firewall
3. Nenhum outro serviço usando a porta 80 no host

---

## Atenção: mudança de portas

Com SSL, o LiveBridge passa a usar as portas padrão:

| Antes | Depois |
|-------|--------|
| 8081 (HTTP) | 80 (HTTP) e 443 (HTTPS) |

Se você usava `http://IP:8081`, passe a usar `https://seu-dominio.com`.

---

## Configuração

### 1. Subir os serviços

```bash
cd server
docker compose up -d
```

### 2. Executar o script de SSL

```bash
chmod +x scripts/setup-ssl.sh
./scripts/setup-ssl.sh video.seudominio.com
```

O script irá:
- Obter os certificados Let's Encrypt
- Atualizar o nginx com SSL
- Reiniciar o nginx

### 3. Atualizar CORS (se o frontend estiver em outro domínio)

No `.env`, adicione a URL HTTPS ao `CORS_ORIGINS`:

```
CORS_ORIGINS=https://video.seudominio.com,https://app.seudominio.com,http://localhost:3000
```

Reinicie a API: `docker compose restart api`

---

## Renovação automática

Os certificados Let's Encrypt expiram em 90 dias. Para renovar automaticamente, adicione ao crontab:

```bash
crontab -e
```

Adicione a linha (ajuste o caminho):

```
0 3 1 * * cd /root/livebridge/server && docker compose run --rm certbot renew && docker compose restart nginx
```

Isso renova todo dia 1 às 3h.

---

## Configuração manual

Se preferir não usar o script:

1. **Obter certificados:**
   ```bash
   docker compose up -d nginx
   docker compose run --rm certbot certonly \
     --webroot -w /var/www/certbot \
     -d video.seudominio.com \
     --email seu@email.com \
     --agree-tos --non-interactive
   ```

2. **Substituir SEU_DOMINIO** em `player/nginx-with-ssl.conf` pelo seu domínio

3. **Aplicar a config:**
   ```bash
   cp player/nginx-with-ssl.conf player/nginx.conf
   # Ou: sed "s/SEU_DOMINIO/video.seudominio.com/g" player/nginx-with-ssl.conf > player/nginx.conf
   ```

4. **Reiniciar:**
   ```bash
   docker compose restart nginx
   ```
