# LiveBridge

Servidor de streaming ao vivo com HLS. Simples, com áudio e delay ~5-10s.

## Início rápido

```bash
cd server
docker compose up -d
```

## Como usar

### Publicar (OBS)

- **Servidor:** `rtmp://SEU_IP:1935/live`
- **Chave:** qualquer nome (ex: `teste`)

### Assistir

- **Player:** `http://SEU_IP:8081/`
- **Ao vivo:** digite o nome do stream e clique em **Assistir ao vivo**
- **Gravações:** aba "Gravações" para listar e assistir transmissões gravadas no R2

## Portas

| Porta  | Uso              |
|--------|------------------|
| 1935   | RTMP (OBS)       |
| 3000   | API (gravações)  |
| 8081   | Player web       |
| 8888   | HLS              |

## Firewall (Hostinger VPS)

Se o OBS der **"conexão expirou"**, libere as portas no **hPanel → VPS → Firewall**:

| Porta | Protocolo | Uso        |
|-------|-----------|------------|
| 1935  | TCP       | RTMP (OBS) |
| 8081  | TCP       | Player     |
| 8888  | TCP       | HLS        |
| 3000  | TCP       | API        |

Regra: **Accept** → **TCP** → **Porta** → **Anywhere**

## OBS — configuração

- **Encoder:** x264 ou NVENC (H.264)
- **Intervalo de keyframe:** 1–2 segundos
- **Bitrate:** 2500–6000 kbps

## Gravação (estilo YouTube)

Ao terminar a live, os segmentos são unidos em um único `.mp4` e enviados ao R2.

- **Durante:** MediaMTX grava segmentos `.ts`
- **Ao parar:** Hook `runOnNotReady` chama o serviço de merge
- **Merge:** ffmpeg concatena, gera UUID, envia ao R2 como `recordings/videos/{uuid}.mp4`

## R2 (Cloudflare)

As gravações (`.mp4`) são enviadas automaticamente para Cloudflare R2.

1. Crie um bucket "livebridge" no R2
2. **Rclone** — credenciais em `server/rclone/rclone.conf` (copie de `rclone.conf.example`)
3. **API de gravações** — crie `server/.env` com `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY` (veja `server/.env.example`)
4. O sync roda a cada 60 segundos; a aba **Gravações** no player lista e reproduz as transmissões gravadas

**Estrutura no R2:** `recordings/live/NOME_DO_STREAM/YYYY-MM-DD_HH-MM-SS/*.ts`

### Gravações não carregam no player?

**Padrão:** a API faz proxy dos segmentos (sem CORS).

**Alternativa (URLs diretas do R2):** se o proxy falhar, use `USE_PRESIGNED=1` no `.env` e configure CORS no bucket R2:

1. R2 → seu bucket → **Settings** → **CORS Policy**
2. Cole:
```json
[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
```
3. No `.env`: `USE_PRESIGNED=1`
