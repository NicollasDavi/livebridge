# LiveBridge

Servidor de streaming ao vivo com **latência sub-segundo** (WebRTC) e HLS.

## Início rápido

```bash
cd server
docker compose up -d
```

## Como usar

### Publicar (OBS, FFmpeg)

- **Servidor:** `rtmp://SEU_IP:1935/live`
- **Chave:** qualquer nome (ex: `teste`)

**URL:** `rtmp://SEU_IP:1935/live/teste`

### Assistir

- **Player web:** `http://SEU_IP:8081/`
  - **Assistir ao vivo (&lt;1s)** — WebRTC, latência mínima
  - **Assistir com pausa/voltar** — HLS Low-Latency, pode pausar e voltar ~30s

- **WebRTC direto:** `http://SEU_IP:8889/live/teste`
- **HLS direto:** `http://SEU_IP:8888/live/teste/index.m3u8`

## Portas

| Porta       | Protocolo | Uso           |
|-------------|-----------|---------------|
| 1935        | TCP       | RTMP (OBS)    |
| 8081        | TCP       | Player web    |
| 8189        | **UDP**   | WebRTC mídia  |
| 8888        | TCP       | HLS           |
| 8889        | TCP       | WebRTC sinal  |

**Firewall:** libere **8189/UDP** e **8189/TCP** para o WebRTC funcionar.

## OBS — configuração recomendada

- **Encoder:** x264 ou NVENC (H.264) — evite HEVC/AV1
- **Intervalo de keyframe:** 1–2 segundos (importante para baixa latência)
- **Bitrate:** 2500–6000 kbps

## Estrutura

```
livebridge/
└── server/
    ├── docker-compose.yml
    ├── mediamtx/
    │   └── mediamtx.yml
    ├── nginx.conf         # (legado, não usado)
    └── player/
        └── index.html
```
