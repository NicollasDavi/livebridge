# LiveBridge

Servidor de streaming ao vivo com HLS.

**📖 [Documentação Técnica](DOCUMENTACAO_TECNICA.md)** — Explicação extensa de cada arquivo, configuração e trecho de código, com o propósito de cada decisão técnica.

**📋 [Manual de Manutenção](MANUTENCAO.md)** — Guia prático para operação e troubleshooting.

**🔗 [Frontend Externo](docs/Frontend-Externo.md)** — Guia completo para integrar o LiveBridge com seu frontend (Angular, React, Vue, etc.).

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

- **API/HLS:** `http://localhost:8081` (ou `http://SEU_IP:8081`)
- O frontend foi removido. Use seu próprio frontend e integre via `docs/Frontend-Externo.md`

## Portas

| Porta  | Uso              |
|--------|------------------|
| 1935   | RTMP (OBS)       |
| 3000   | API (gravações)  |
| 8082   | Merge (concatena vídeos) |
| 8081   | API + HLS (Nginx)|
| 8888   | HLS              |

## Firewall (Hostinger VPS)

Se o OBS der **"conexão expirou"**, libere as portas no **hPanel → VPS → Firewall**:

| Porta | Protocolo | Uso        |
|-------|-----------|------------|
| 1935  | TCP       | RTMP (OBS) |
| 8081  | TCP       | API/HLS    |
| 8888  | TCP       | HLS        |
| 3000  | TCP       | API        |

Regra: **Accept** → **TCP** → **Porta** → **Anywhere**

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
