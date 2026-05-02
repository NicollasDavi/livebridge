# API Java — Rotas (catálogo) e especificação para implementação (agente IA)

Documento **só com rotas** e contratos HTTP. Destina-se a **implementar a API Java** (Spring ou outro) que faz **autorização + JWT + proxy** para o LiveBridge.

**Live só multiresolução (escopo reduzido):** [**`API_JAVA_LIVE_MULTIRESOLUCAO.md`**](API_JAVA_LIVE_MULTIRESOLUCAO.md).

**Base do LiveBridge (servidor Java → LB):** `LIVEBRIDGE_URL` (ex.: `http://localhost:8081`; em Docker, não usar `localhost` se o LB estiver no host).

**Segredo partilhado:** `VIDEO_ACCESS_SECRET` (igual ao `.env` do LiveBridge). JWT: **HS256**.

---

## 1. Catálogo — o que o frontend chama na Java

| # | Método | Rota (Java) | Body / query | Resposta esperada (200) | Proxy / chamada ao LiveBridge |
|---|--------|-------------|--------------|-------------------------|-------------------------------|
| 1 | `POST` | `/api/lessons/check-live-access` | Body: `{ "streamName": string }` | `{ "token": string }` | Não. Gerar JWT (ver §3.1). |
| 2 | `POST` | `/api/init-live` | Body: `{ "streamName": string, "token": string }` | `{ "ok": true }` | Validar JWT; opcional repassar `POST {LB}/api/init-live` mesmo body; definir cookie `vid_live` (ver §4). |
| 3 | `GET` | `/hls/live/*` | Path após prefixo: ex. `live/matematica_720/index.m3u8` | Stream M3U8/TS | `GET {LB}/hls/live/<mesmo-path>`. Reenviar header `Cookie` do cliente. |
| 4 | `GET` | `/api/live/hls-master` | Query: `streamName` | M3U8 | **Obrigatório para ABR:** proxy `GET {LB}/api/live/hls-master.m3u8?streamName=<igual>`. Reenviar `Cookie` se aplicável. |
| 5 | `GET` | `/api/live/transmissoes` | — | JSON | `GET {LB}/api/live/transmissoes`. Sem cookie LB obrigatório. |
| 6 | `POST` | `/api/lessons/check-video-access` | Body: `{ "path": string, "session": string }` | `{ "token": string }` | Não. Gerar JWT (ver §3.2). |
| 7 | `GET` | *(no browser do produto)* | — | — | O browser **não** chama `/api/recordings/video` do spec diretamente: usa **`GET /api/video/play`** (ex.: `lessonId`, `variant`, `playToken` ou Bearer). A **Java** chama por baixo `GET {LB}/api/recordings/video?path=&session=&token=&variant=`. |
| 8 | `POST` | `/api/recordings/live-ended` | Body: JSON (ver §2.1) | JSON (repassar LB) | `POST {LB}/api/recordings/live-ended` mesmo body. |
| 9 | `POST` | `/api/recordings/lesson-boundary` | Body: JSON (ver §2.2) | JSON (repassar LB) | `POST {LB}/api/recordings/lesson-boundary` mesmo body. |

Rotas **opcionais** (proxy transparente):

| Método | Rota (Java) | LiveBridge |
|--------|-------------|------------|
| `GET` | `/api/recordings/status` | `GET {LB}/api/recordings/status?streamName=&session=` |
| `GET` | `/api/recordings/merge-progress` | `GET {LB}/api/recordings/merge-progress?path=&session=` |
| `GET` | `/api/recordings/pending` | `GET {LB}/api/recordings/pending` |

**Gravação parcial (HLS enquanto compacta):** **não** há proxy na Java para `GET /api/recordings/hls/**`. O LiveBridge devolve no JSON (ex. `lesson-boundary`) um `hlsUrl` relativo ao LB; o cliente usa essa URL **contra o LiveBridge** (ou conforme política de domínio), não uma rota espelhada na Java.

---

## 2. Corpos JSON — live-ended e lesson-boundary

### 2.1 `POST /api/recordings/live-ended`

**Obrigatório:** `streamName` (string).

**Opcional:** `name`, `materia`, `n_aula`, `frente`, `professor`, `folder_ids` (array), `course_ids` (array).

```json
{
  "streamName": "matematica",
  "name": "string | null",
  "materia": "string | null",
  "n_aula": 1,
  "frente": "string | null",
  "professor": "string | null",
  "folder_ids": [],
  "course_ids": []
}
```

Repassar **byte a byte** o JSON recebido do front para o LiveBridge (ou validar tipos e reencaminhar).

### 2.2 `POST /api/recordings/lesson-boundary`

**Obrigatório:** `streamName` (string).

**Opcional:** igual a 2.1.

```json
{
  "streamName": "matematica",
  "name": "string | null",
  "materia": "string | null",
  "n_aula": 1,
  "frente": "string | null",
  "professor": "string | null",
  "folder_ids": [],
  "course_ids": []
}
```

**Resposta LiveBridge (exemplo):** `ok`, `path`, `session`, `status`, `hlsUrl`, `mergeProgressUrl` (paths relativos ao LB).

---

## 3. JWT — payloads exatos

### 3.1 Live — `check-live-access`

- Claims: `streamName` = nome **base** RTMP (ex.: `matematica`), **sem** `_1080/_720/_480`.
- `exp`, `iat`: recomendado `exp` = now + 14400 s.
- Algoritmo: **HS256**, secret = `VIDEO_ACCESS_SECRET`.

### 3.2 VOD — `check-video-access`

- Claims: `path` (ex.: `live/matematica`), `session` (ex.: `2026-03-30_10-00-00_aula`) — **iguais** aos usados na query de vídeo.
- `exp`: recomendado now + 3600 s.
- Algoritmo: **HS256**.

### 3.3 `init-live`

- Validar JWT do body: assinatura, `exp`, claim `streamName` === body `streamName`.
- Cookie **`vid_live`**: valor = o mesmo JWT string (ou o que o LiveBridge espera; o LB valida como Bearer no cookie conforme implementação atual). httpOnly, `Path=/hls` (ou `/` se proxy incluir só `/hls` no mesmo host), SameSite adequado ao domínio.

---

## 4. Proxy HLS — regras

1. Path cliente: `/hls/live/<stream>_<1080|720|480>/index.m3u8` (playlist = **`index.m3u8`**, nunca `main_stream.m3u8`).
2. Upstream: `{LIVEBRIDGE_URL}/hls/live/<mesmo path relativo>`.
3. Headers: repassar `Cookie` do pedido; repassar `Range` se existir (segmentos).
4. Respostas: repassar status e corpo do LB (2xx/4xx/5xx).

---

## 5. Erros HTTP — comportamento da Java

| Situação | Resposta Java |
|----------|----------------|
| Sessão do utilizador inválida nos `POST` de check-* | `403` JSON `{ "error": "..." }` |
| Body inválido / campo obrigatório ausente | `400` |
| LiveBridge indisponível | `502` ou `503` com mensagem curta |
| Repassar 4xx/5xx do LB em proxies | Opcional mapear ou repassar status + corpo |

---

## 6. Instruções para o agente de IA (implementação)

**Objetivo:** Expor as rotas da tabela §1 na API Java, autenticando o utilizador (cookie de sessão existente do produto) antes de gerar JWT ou proxy.

**Ordem sugerida de implementação:**

1. Config: `LIVEBRIDGE_URL`, `VIDEO_ACCESS_SECRET` (properties/env).
2. `POST /api/lessons/check-live-access` + `POST /api/lessons/check-video-access` (JWT apenas).
3. `POST /api/init-live` (validação JWT + cookie `vid_live`).
4. `GET /hls/live/**` (proxy reverso com `WebClient`/`RestTemplate` streaming ou nginx-style; preservar cookie).
5. `GET /api/live/hls-master` e `GET /api/live/transmissoes` (proxy simples).
6. `POST /api/recordings/live-ended` e `POST /api/recordings/lesson-boundary` (proxy JSON).
7. VOD: expor `GET /api/video/play` (ou equivalente) no produto; internamente chamar `{LB}/api/recordings/video`.
8. Opcionais: status, merge-progress, pending. **Sem** proxy `recordings/hls` na Java.

**Não implementar no Java:** transcodificação, S3/R2, MediaMTX, merge ffmpeg — só HTTP para o LiveBridge.

**Testes mínimos:**

- Com LB de pé: `check-live-access` → token válido decodificável com mesmo secret.
- `init-live` com token válido → cookie definido; `GET` proxy para `.../index.m3u8` retorna não-500 quando há stream no LB.
- `transmissoes` repassa JSON com `items`.

**Armadilhas:**

- `localhost` no `LIVEBRIDGE_URL` dentro de container Docker.
- Playlist HLS com nome errado (`main_stream.m3u8`).
- JWT live com `streamName` contendo sufixo `_720` no **emit** (deve ser nome **base**); no **proxy**, validar com a mesma lógica do LiveBridge: aceitar `teste_480` se o JWT tiver `streamName=teste` (remover sufixo `_1080|720|480` do segmento do path). Caso contrário **403** antes de chegar ao LB — ver **`API_JAVA_LIVE_MULTIRESOLUCAO.md`** (secção validação proxy HLS).

---

## 7. Rotas do LiveBridge (referência — não expor ao browser se usar proxy)

| Método | Path LB |
|--------|---------|
| `POST` | `/api/init-live` |
| `GET` | `/api/check-video-access?stream=` (interno nginx; não é rota do front) |
| `GET` | `/api/live/hls-master.m3u8` |
| `GET` | `/api/live/transmissoes` |
| `GET` | `/hls/live/...` |
| `GET` | `/api/recordings/video` |
| `POST` | `/api/recordings/live-ended` |
| `POST` | `/api/recordings/lesson-boundary` |
| `GET` | `/api/recordings/status` |
| `GET` | `/api/recordings/merge-progress` |
| `GET` | `/api/recordings/pending` |

Fim do documento.
