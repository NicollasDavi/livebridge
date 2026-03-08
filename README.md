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
- Digite o nome do stream e clique em **Assistir ao vivo**

## Portas

| Porta  | Uso        |
|--------|------------|
| 1935   | RTMP (OBS) |
| 8081   | Player web |
| 8888   | HLS        |

## OBS — configuração

- **Encoder:** x264 ou NVENC (H.264)
- **Intervalo de keyframe:** 1–2 segundos
- **Bitrate:** 2500–6000 kbps
