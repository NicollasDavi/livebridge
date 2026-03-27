# LiveBridge — Rotas para vídeos

## 1. Vídeos do R2 (já enviados)

```
GET http://localhost:8081/api/recordings
```

Retorna os vídeos `.mp4` que **já estão no R2**.

**Antes:** `GET http://localhost:8081/api/init` (define cookie).

---

## 2. Vídeos de live-ended (aulas registradas, ainda não no R2)

```
GET http://localhost:8081/api/recordings/pending
```

Retorna as aulas que foram finalizadas com `live-ended` — já registradas como aula na API Java, mas que **ainda podem estar sendo processadas** (merge/upload) ou já prontas.

| Campo | Descrição |
|-------|-----------|
| `streamName` | Nome do stream |
| `path` | Ex: `live/matematica` |
| `session` | Ex: `2025-03-09_16-33-50` |
| `status` | `processing` (compactando/enviando) ou `ready` (já no R2) |
| `videoPath` | `path/session.mp4` quando `status === 'ready'` |
| `endedAt` | Quando foi finalizado |

**Exemplo de resposta:**
```json
[
  {
    "streamName": "matematica",
    "path": "live/matematica",
    "session": "2025-03-09_16-33-50",
    "status": "processing",
    "videoPath": null,
    "endedAt": "2025-03-09T16:45:00.000Z",
    "updatedAt": "2025-03-09T16:45:01.000Z"
  }
]
```

**Uso:** Mostrar no frontend as aulas que acabaram de finalizar, com status "Compactando e enviando..." até ficarem `ready`.
