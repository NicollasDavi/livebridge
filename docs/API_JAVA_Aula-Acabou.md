# API Java — "Aula acabou"

O que a API Java precisa fazer: **chamar** o LiveBridge. Existem duas rotas:

| Rota | Quando usar |
|------|-------------|
| `POST /api/recordings/live-ended` | Live inteira acabou (encerra gravação) |
| `POST /api/recordings/lesson-boundary` | Uma aula acabou, mas a live continua (salva parte; vídeo em .ts disponível via HLS enquanto compacta) |

---

## 1. Live inteira acabou — `POST /api/recordings/live-ended`

Quando o operador clicar em "Live acabou" (encerra tudo), a API Java chama:

```
POST {LIVEBRIDGE_URL}/api/recordings/live-ended
Content-Type: application/json

{
  "streamName": "matematica",
  "name": "live/matematica/2025-03-09_16-33-50.mp4",
  "materia": "Matemática",
  "n_aula": 1,
  "frente": "Exatas",
  "professor": "João Silva",
  "folder_ids": ["uuid-pasta"],
  "course_ids": ["uuid-curso"]
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `streamName` | string | sim | Nome do stream (ex.: matematica) |
| `name` | string | não | Nome do vídeo. Se omitido, usa o path (igual ao R2) |
| `materia`, `n_aula`, `frente`, `professor` | - | não | Metadados para a API de Vídeos |
| `folder_ids`, `course_ids` | UUID[] | não | IDs de pastas/cursos |

**Fluxo no LiveBridge:**
1. Descobre `path` e `session` no disco
2. **Imediatamente** chama `POST /api/videos` com `path` = `live/{stream}/{session}.mp4` (mesmo que vai pro R2)
3. Dispara o merge em background

**Response 200:**
```json
{
  "ok": true,
  "path": "live/matematica",
  "session": "2025-03-09_16-33-50",
  "status": "processing",
  "message": "Gravação finalizada. Processamento iniciado em background."
}
```

---

## 1b. Aula acabou (live continua) — `POST /api/recordings/lesson-boundary`

Quando o operador clicar em "Aula acabou" durante uma live com várias aulas em sequência:

```
POST {LIVEBRIDGE_URL}/api/recordings/lesson-boundary
Content-Type: application/json

{
  "streamName": "matematica",
  "name": "live/matematica/2025-03-09_17-15-00_aula.mp4",
  "materia": "Matemática",
  "n_aula": 1,
  ...
}
```

**Fluxo:** Copia os `.ts` atuais para uma pasta parcial → registra na API de Vídeos → dispara merge em background. O vídeo fica disponível via HLS (`hlsUrl` na resposta) enquanto compacta e sobe pro R2.

**Response 200:**
```json
{
  "ok": true,
  "path": "live/matematica",
  "session": "2025-03-09_17-15-00_aula",
  "status": "processing",
  "hlsUrl": "/api/recordings/hls/playlist.m3u8?path=...&session=...",
  "message": "Aula registrada. Vídeo disponível em HLS enquanto compacta. Processamento em background."
}
```

---

## 2. API de Vídeos — `POST /api/videos`

O **LiveBridge** chama esta rota **antes do merge**, assim que recebe `live-ended`. O `path` e `name` (se não informado) são iguais ao que será gravado no R2.

**Body enviado pelo LiveBridge:**
```json
{
  "name": "live/matematica/2025-03-09_16-33-50.mp4",
  "path": "live/matematica/2025-03-09_16-33-50.mp4",
  "materia": null,
  "n_aula": null,
  "frente": null,
  "professor": null,
  "folder_ids": [],
  "course_ids": []
}
```

O `path` segue sempre o formato `live/{stream}/{session}.mp4` — o mesmo do R2.

---

## 3. Status — `GET /api/recordings/status`

```
GET {LIVEBRIDGE_URL}/api/recordings/status?streamName=matematica
```

Retorna: `live` | `processing` | `ready` | `no_session`.

---

## Resumo

| Momento | Ação |
|---------|------|
| Operador clica "Live acabou" | API Java → `POST /api/recordings/live-ended` |
| Operador clica "Aula acabou" (live continua) | API Java → `POST /api/recordings/lesson-boundary` |
| LiveBridge recebe | Copia .ts (lesson-boundary) ou usa sessão atual (live-ended) → **`POST /api/videos`** → dispara merge |
| Enquanto processa | Frontend usa `hlsUrl` para reproduzir via HLS (hls.js) |
| Merge conclui | Callback atualiza status para `ready` → vídeo em `/api/recordings/video` |
