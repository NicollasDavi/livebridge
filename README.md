# LiveBridge

Servidor de streaming ao vivo com HLS.

**📖 [Documentação Técnica](DOCUMENTACAO_TECNICA.md)** — Explicação extensa de cada arquivo, configuração e trecho de código, com o propósito de cada decisão técnica.

**📋 [Manual de Manutenção](MANUTENCAO.md)** — Guia prático para operação e troubleshooting.

**🔗 [Frontend Externo](docs/Frontend-Externo.md)** — Guia completo para integrar o LiveBridge com seu frontend (Angular, React, Vue, etc.).

**🎬 [Guia Player Front do Zero](docs/GUIA_PLAYER_FRONT_DO_ZERO.md)** — Implementação recomendada de player live + gravações, com fluxo completo e boas práticas.

**⚡ [API — Performance e paginação](docs/API-Integracao-Performance-e-Paginacao.md)** — Logs, `GET /api/recordings?paginate=1`, variáveis de ambiente e impacto na integração.

## Início rápido

```bash
cd server
docker compose up -d
```

## Como usar

### Publicar (OBS)

- **Servidor:** `rtmp://SEU_IP:80/live` (no host a porta **80** é RTMP; dentro do contentor o MediaMTX continua na **1935**)
- **Chave:** qualquer nome (ex: `teste`)

### Assistir

- **API/HLS (HTTPS):** `https://SEU_IP/` (porta **443**)
- **Só na VM:** `http://127.0.0.1:8081` (nginx HTTP interno; não está exposto na internet)
- O frontend foi removido. Use seu próprio frontend e integre via `docs/Frontend-Externo.md`

## Portas (padrão atual do `docker-compose.yml`)

| Porta (host) | Uso |
|--------------|-----|
| **80** | RTMP (OBS → MediaMTX) |
| **443** | HTTPS — site, `/api/*`, HLS via nginx |
| **127.0.0.1:8081** | HTTP nginx (só localhost) |
| **127.0.0.1:8082** | Merge (só localhost; a API usa a rede Docker) |
| **3000** | API — só rede Docker, não publicada no host |
| **8888** | HLS MediaMTX — só rede Docker |

## Firewall

Para **só 80 e 443** na internet: **TCP 80** (RTMP) e **TCP 443** (HTTPS).  
Algumas redes corporativas inspecionam a **80** e podem interferir com RTMP; nesse caso é preciso outra estratégia (ex.: ingest noutro endpoint).

## OBS — configuração para transmissão de aula

| Parâmetro | Valor | Motivo |
|-----------|-------|--------|
| **Encoder** | NVENC (GPU) ou x264 | H.264, compatível |
| **Intervalo de keyframe** | 2 segundos | Menor latência |
| **Resolução** | 1280×720 (720p) | Equilíbrio qualidade/tamanho |
| **Bitrate vídeo** | 4500–5500 kbps | Texto legível, tela clara |
| **Bitrate áudio** | **160 kbps** | Voz clara (prioridade na aula) |
| **Sample rate áudio** | 48 kHz | Padrão para streaming |

**Se usar 1080p:** bitrate vídeo 6000–8000 kbps.

O merge usa **HEVC (H.265)** com preset **veryslow** e CRF ~28, mais **AAC 64k** — prioridade em **menor tamanho de arquivo** (encode mais lento). Ajuste em `.env`: `COMPRESS_CODEC`, `COMPRESS_PRESET`, `COMPRESS_CRF`, `COMPRESS_AUDIO_BITRATE`.

## Gravação no R2 (Cloudflare)

1. Crie um bucket no R2 e configure `.env` com `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`
2. Durante a live, o MediaMTX grava segmentos localmente
3. Ao encerrar a transmissão, o **serviço merge** (após ~2 min sem novos segmentos) concatena tudo em um `.mp4` e envia ao R2
4. O frontend lista e reproduz os vídeos via `GET /api/recordings`
5. Metadata editável via `PUT /api/recordings/metadata`

**Estrutura no R2:** `recordings/videos/live/NOME_DO_STREAM/YYYY-MM-DD_HH-MM-SS.mp4`

**Nomes customizados:** Os títulos das aulas são salvos em `server/api/data/recordings-names.json` (volume montado no Docker).

**Compressão (padrão):** `COMPRESS_CODEC=h265`, `COMPRESS_PRESET=veryslow`, CRF 28, AAC 64k — máxima compactação prática. Encode bem mais lento; para acelerar: `COMPRESS_PRESET=fast` ou `COMPRESS_CODEC=h264`. Players antigos: `COMPRESS_CODEC=h264`. Sem reencode: `COMPRESS_VIDEO=0`. Timeout: `FFMPEG_TIMEOUT_MS=43200000` (12h).

### Gravações não carregam no frontend?

**Padrão:** a API faz proxy dos segmentos (sem CORS).

**Alternativa (URLs diretas do R2):** se o proxy falhar, use `USE_PRESIGNED=1` no `.env` e configure CORS no bucket R2:

1. R2 → seu bucket → **Settings** → **CORS Policy**
2. Cole:
```json
[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
```
3. No `.env`: `USE_PRESIGNED=1`
