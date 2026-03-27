# Progresso de processamento de vídeo (merge) — multiresolução

A API Java (ou qualquer cliente server-side) consulta o **mesmo endpoint** de antes; o JSON de progresso foi **estendido** para descrever o processo atual, a **resolução em andamento** e o estado **cada variante** (1080p, 720p, 480p) quando o merge está configurado para múltiplas saídas.

## Endpoint

```
GET {BASE}/api/recordings/merge-progress?path={path}&session={session}
```

- **BASE**: URL do LiveBridge visto pelo Java (ex.: `http://api:3000` na rede Docker, ou `https://seu-host:8081` via Nginx).
- **path** e **session**: iguais aos retornados por `lesson-boundary`, `pending`, `status` ou ao montar a partir de `mergeProgressUrl`.

Autenticação: no código atual esta rota **não** exige JWT; em produção restrinja por rede ou alinhe com o mesmo esquema das outras rotas.

## Comportamento do merge (serviço `merge`)

| Variável | Efeito |
|----------|--------|
| `MERGE_RESOLUTIONS=1080,720,480` (padrão no `docker-compose`) | Gera **três** MP4 por sessão, com altura máxima 1080 / 720 / 480 px (`force_original_aspect_ratio=decrease` — não estica acima da fonte). |
| `MERGE_RESOLUTIONS=single` | Comportamento legado: **um** arquivo `{session}.mp4`. |

**Obrigatório para multiresolução:** `COMPRESS_VIDEO=1`. Com `COMPRESS_VIDEO=0` (copy), o serviço ignora a lista e gera **apenas um** arquivo.

Ordem de trabalho (multiresolução):

1. Encode **1080p** → upload R2  
2. Encode **720p** → upload R2  
3. Encode **480p** → upload R2  

Chaves no R2 (prefixo `recordings/videos/`):

- `{path}/{session}_1080.mp4`
- `{path}/{session}_720.mp4`
- `{path}/{session}_480.mp4`

Ex.: `recordings/videos/live/matematica/2026-03-20_20-05-35_aula_1080.mp4`

## Campos principais da resposta (`schemaVersion` 2)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `schemaVersion` | `2` | Presença indica formato detalhado. |
| `mergeMode` | `"multi"` \| `"single"` | Várias resoluções ou arquivo único. |
| `videoCodec` | `"hevc"` \| `"h264"` | Codec de vídeo usado no encode (áudio AAC conforme `COMPRESS_AUDIO_BITRATE`). |
| `phase` | string | Fase global: `encoding`, `uploading`, `done`, `failed`, `idle`. |
| `currentVariant` | objeto \| `null` | Resolução **ativa no momento** (a que está a codificar ou a enviar). |
| `currentResolution` | objeto \| `null` | Alias de `currentVariant` (mesmo conteúdo). |
| `variants` | array \| `null` | No modo `single`, em geral `null`. No `multi`, lista com estado por resolução. |
| `percentOverall` | número | 0–100 aproximado (soma ponderada: ~75% encode total + ~25% upload total, repartidos pelas variantes). |
| `encodingPercent` | número \| `null` | No `multi`, costuma refletir o **encode da variante atual**. No `single`, o encode global. |
| `uploadPercent` | número \| `null` | Upload da variante atual (multi) ou do único ficheiro (single). |
| `message` | string | Texto legível para UI ou logs. |
| `durationSec` | número \| `null` | Duração estimada da timeline (ffprobe no concat), quando disponível. |
| `currentTimeSec` | número \| `null` | Tempo já processado no encode da variante atual. |
| `etaSecondsEncoding` | número \| `null` | ETA do encode da variante atual. |
| `etaSecondsOverall` | número \| `null` | ETA global aproximado (upload incluído quando aplicável). |
| `bytesUploaded` / `bytesTotal` | número \| `null` | Durante upload da variante atual. |

### Objeto `currentVariant` / `currentResolution`

```json
{
  "height": 720,
  "label": "720p",
  "index": 2,
  "total": 3
}
```

- **index** / **total**: posição na fila (1-based), ex. “2/3” = segundo ficheiro.

### Itens de `variants[]` (modo `multi`)

| Campo | Descrição |
|-------|-----------|
| `id`, `label` | Ex.: `1080p` |
| `height` | `1080`, `720`, `480` |
| `phase` | `pending` → `encoding` → `uploading` → `done` (ou `failed`) |
| `encodingPercent` | 0–100 durante encode |
| `uploadPercent` | 0–100 durante upload |
| `r2Key` | Chave completa no bucket após upload (ou `null` antes) |
| `bytesUploaded` / `bytesTotal` | Durante upload |
| `currentTimeSec`, `durationSec`, `etaSecondsEncoding` | Durante encode |

## Exemplo de resposta (convertendo 720p, 2.º ficheiro)

```json
{
  "path": "live/matematica",
  "session": "2026-03-20_20-05-35_aula",
  "schemaVersion": 2,
  "mergeMode": "multi",
  "videoCodec": "hevc",
  "phase": "encoding",
  "currentVariant": { "height": 720, "label": "720p", "index": 2, "total": 3 },
  "currentResolution": { "height": 720, "label": "720p", "index": 2, "total": 3 },
  "variants": [
    { "id": "1080p", "height": 1080, "label": "1080p", "phase": "done", "encodingPercent": 100, "uploadPercent": 100, "r2Key": "recordings/videos/live/matematica/2026-03-20_20-05-35_aula_1080.mp4" },
    { "id": "720p", "height": 720, "label": "720p", "phase": "encoding", "encodingPercent": 34, "uploadPercent": null, "r2Key": null },
    { "id": "480p", "height": 480, "label": "480p", "phase": "pending", "encodingPercent": null, "uploadPercent": null, "r2Key": null }
  ],
  "percentOverall": 52,
  "encodingPercent": 34,
  "uploadPercent": 0,
  "message": "Convertendo 720p (2/3)…",
  "durationSec": 3600,
  "currentTimeSec": 1224.5,
  "etaSecondsEncoding": 2400,
  "etaSecondsOverall": 2600,
  "bytesUploaded": 0,
  "bytesTotal": null,
  "updatedAt": "2026-03-25T12:00:00.000Z"
}
```

## Callback `POST /api/recordings/upload-complete`

Quando o merge termina com sucesso, o serviço `merge` chama a API Node com um corpo JSON estendido:

```json
{
  "path": "live/matematica",
  "session": "2026-03-20_20-05-35_aula",
  "variants": [
    { "height": 1080, "label": "1080p", "id": "1080p", "key": "recordings/videos/live/matematica/2026-03-20_20-05-35_aula_1080.mp4" },
    { "height": 720, "label": "720p", "id": "720p", "key": "recordings/videos/..." },
    { "height": 480, "label": "480p", "id": "480p", "key": "recordings/videos/..." }
  ]
}
```

No modo `single`, `variants` tem um único item com `label: "single"` e a chave do MP4 único.

A API Java pode continuar a tratar só `path` + `session` para limpar estado local; para guardar links por qualidade, use o array `variants[].key`.

## Polling (Java)

- Intervalo sugerido: 1,5–3 s.
- Parar quando `phase === "done"` ou `phase === "failed"` ou `phase === "idle"` (ficheiro de progresso ausente após TTL).
- UI: mostrar `message` e, no `multi`, uma linha por item em `variants` com `phase` / percentagens.

## Listagem (`GET /api/recordings`)

Cada objeto `.mp4` vira um item. Para ficheiros `session_1080.mp4` / `_720` / `_480`, o JSON inclui:

- **`session`**: nome lógico da sessão (sem sufixo `_1080` etc.), para alinhar com `lesson-boundary` / Java.
- **`variant`**: `1080p` | `720p` | `480p` ou `null` (ficheiro único legado).
- **`id`**: `path|session` (igual para as três variantes — metadata da API Lessons aplica-se a todas).

## Playback no R2 (`GET /api/recordings/video`)

Sem `variant`, a API tenta nesta ordem: `{session}.mp4`, `{session}_1080.mp4`, `{session}_720.mp4`, `{session}_480.mp4`.

- Forçar qualidade: `?variant=1080` | `720` | `480` (junto com `path`, `session` e auth habituais).

## Nota: live ABR vs merge

As **três qualidades HLS durante a live** (MediaMTX + `transcode-abr.sh`) são independentes deste fluxo. O documento acima refere-se ao **pós-gravação** (concatenação dos `.ts`, encode e upload para o R2).
