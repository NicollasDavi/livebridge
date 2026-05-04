# HLS devolve HTML em vez de M3U8 (landing “LiveBridge API”)

## Sintoma

- Pedido a `/hls/live/…/index.m3u8` (ou outra playlist).
- Resposta: `Content-Type: text/html` e corpo com a página estática `index.html` (“Frontend removido…”, `server/static/index.html`).

Isto **não** vem do MediaMTX. Indica que o **nginx** caiu no `location /` com `try_files $uri $uri/ /index.html` — o prefixo `/hls/` **não** foi aplicado ao pedido (ou o tráfego **não** chegou ao contentor certo).

## Causas habituais

1. **Nginx na VM ≠ o ficheiro do repositório**  
   O `docker-compose` mapeia `server/nginx/nginx.conf` → `conf.d/default.conf`. Se o deploy for antigo, outro ficheiro, ou o serviço corre fora do Docker, o `location /hls/` pode não existir.

2. **Porta / host**  
   No `docker-compose` do LiveBridge, o **nginx** publica `443:443` e `127.0.0.1:8081:8080`. Acesso HTTPS à IP/hostname deve bater no contentor `livebridge-player`. Se um reverse proxy à frente (GCP LB, outro nginx) encaminhar só `/api/` ou só `/`, `/hls/` pode ir parar a outra app que serve SPA/HTML.

3. **Nome do path MediaMTX vs OBS**  
   Com **ABR** (`matematica_1080`, `_720`, `_480`), as playlists válidas costumam estar sob **`/hls/live/matematica_480/main_stream.m3u8`** (ou `index.m3u8` na variante), não necessariamente `/hls/live/matematica/index.m3u8` sem sufixo. Um **404** do upstream seria JSON/text do MediaMTX, não o HTML da landing — mas confirma o path real na pasta do MediaMTX ou na Control API.

4. **Alternativa suportada pela API**  
   Master ABR gerado pela Node:  
   `GET /api/live/hls-master.m3u8?streamName=<nome>`  
   (proxy pelo Java no mesmo padrão dos outros `/api/`). As URLs dentro do M3U8 seguem `LIVE_HLS_PATH_PREFIX` (normalmente `/hls`).

## O que verificar na VM (rápido)

```bash
# Dentro do contentor nginx do LiveBridge
docker exec livebridge-player nginx -t
curl -skI "https://127.0.0.1/hls/live/SEU_STREAM/main_stream.m3u8" || true
```

Sem cookie `vid_live` válido, `auth_request` pode responder **403**, não HTML — se vês HTML, o problema é routing/static, não JWT.

Confirma que `grep -n 'location.*hls' /etc/nginx/conf.d/default.conf` mostra `location ^~ /hls/` (após atualização do repo).

## Nginx e regex dos `.ts`

O `includes/hls-ts-locations.conf` usa regex só para `*.ts` (cache). Os manifests `.m3u8` devem cair no prefixo `location /hls/` — **não** usar `^~ /hls/` sem rever isso: em nginx, `^~` faz saltar as regex e os segmentos `.ts` deixariam de usar o bloco com cache.

## Java / proxy

Se quiserem endurecer o diagnóstico no **BFF**: ao repassar respostas com path que termina em `.m3u8`, se `Content-Type` for `text/html` ou o corpo começar por `<!DOCTYPE`, responder **502** com mensagem explícita — o arranque funcional continua a ser **corrigir upstream/nginx/path**.
