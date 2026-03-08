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

## OBS — configuração

- **Encoder:** x264 ou NVENC (H.264)
- **Intervalo de keyframe:** 1–2 segundos
- **Bitrate:** 2500–6000 kbps

## Gravação no R2 (Cloudflare)

As transmissões são gravadas automaticamente e enviadas para Cloudflare R2.

1. Crie um bucket "livebridge" no R2
2. **Rclone** — credenciais em `server/rclone/rclone.conf` (copie de `rclone.conf.example`)
3. **API de gravações** — crie `server/.env` com `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY` (veja `server/.env.example`)
4. O sync roda a cada 60 segundos; a aba **Gravações** no player lista e reproduz as transmissões gravadas

**Estrutura no R2:** `recordings/live/NOME_DO_STREAM/YYYY-MM-DD_HH-MM-SS/*.ts`
