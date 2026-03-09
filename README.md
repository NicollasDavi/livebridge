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
| 8080   | Merge (concatena vídeos) |
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

O merge grava com CRF 18 + AAC 96k — alta qualidade de imagem, áudio limpo e arquivos menores.

## Gravação no R2 (Cloudflare)

1. Crie um bucket no R2 e configure `.env` com `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`
2. Durante a live, o MediaMTX grava segmentos localmente
3. Ao encerrar a transmissão, o **serviço merge** (após ~2 min sem novos segmentos) concatena tudo em um `.mp4` e envia ao R2
4. A aba **Gravações** lista e reproduz os vídeos completos

**Estrutura no R2:** `recordings/videos/live/NOME_DO_STREAM/YYYY-MM-DD_HH-MM-SS.mp4`

**Compressão (otimizada para aula):** H.264 CRF 18 (vídeo), AAC 96k (áudio), preset slow, tune animation. Alta qualidade, menor tamanho. Desativar: `COMPRESS_VIDEO=0` no `.env`.

### Gravações não carregam no player?

**Padrão:** a API faz proxy dos segmentos (sem CORS).

**Alternativa (URLs diretas do R2):** se o proxy falhar, use `USE_PRESIGNED=1` no `.env` e configure CORS no bucket R2:

1. R2 → seu bucket → **Settings** → **CORS Policy**
2. Cole:
```json
[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
```
3. No `.env`: `USE_PRESIGNED=1`
