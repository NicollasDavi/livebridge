# Java (BFF) e front: rotas, proxy e LiveBridge

Este documento define **o que o backend Java (Spring) deve expor**, **para onde fazer proxy no LiveBridge**, e **o que o front (browser) deve usar** — para cookies, CORS e HLS funcionarem sem o browser falar direto com a porta do LiveBridge (`8081`) em produção.

**Princípio:** o **browser** só fala com o **Java** (ex.: `https://api.seudominio.com` ou `http://localhost:8080`). O Java repassa pedidos ao LiveBridge (`http://livebridge-host:8081` ou URL interna Docker) com os **mesmos cookies** e **query strings** que o cliente enviou, quando aplicável.

---

## 1. Convenções

| Conceito | Valor típico |
|----------|----------------|
| Base do **Java** (BFF) | `http://localhost:8080` (dev) ou URL pública da API |
| Base do **LiveBridge** (nginx + API) | `http://localhost:8081` (mapeamento host → contentor nginx `:8080` interno) |
| Cookie de live HLS | `vid_live` (JWT), definido pelo LiveBridge em `POST /api/init-live` (proxied pelo Java) |
| Cookie de gravações / VOD | `vid_ctx`, definido pelo LiveBridge em `GET /api/init` e usado em rotas `/api/recordings/...` |

**Nomes exatos das rotas no LiveBridge** estão em `server/api/routes/live.js` e `server/api/routes/recordings.js`. O Java deve espelhar os **paths** (`/api/...`) para o cliente não precisar de duas origens.

---

## 2. Rotas que o Java deve criar (proxy transparente)

Para cada linha, implementar um **controller** (ou filtro/gateway) que:

1. Aplica a **mesma segurança** que já usas para o resto da API (sessão do utilizador, etc.).
2. Faz **HTTP** para o LiveBridge: `LIVEBRIDGE_BASE + caminho` com:
   - `GET`/`POST` conforme a tabela;
   - **Query string** copiada do pedido do cliente;
   - Header **`Cookie`** do pedido do cliente repassado (`vid_live`, `vid_ctx`, etc.);
   - Corpo JSON nos `POST`, byte-a-byte nos `GET` de playlists/segmentos/vídeo.

Sugestão de propriedade Spring: `livebridge.base-url=http://localhost:8081` (ou `http://nginx:8080` dentro da mesma rede Docker que o LiveBridge).

### 2.1. Live / HLS / init

| Método | Caminho no cliente (= Java) | Proxy para LiveBridge | Notas |
|--------|------------------------------|------------------------|--------|
| `GET` | `/api/init` | `GET {LB}/api/init` | Define/atualiza `vid_ctx` na resposta; o front deve usar `credentials: 'include'`. |
| `POST` | `/api/init-live` | `POST {LB}/api/init-live` | Body JSON: `{ streamName, token }`. Resposta define cookie **`vid_live`**. |
| `GET` | `/api/live/hls-master.m3u8` | `GET {LB}/api/live/hls-master.m3u8` | Query: `streamName` obrigatório. Resposta: master ABR (texto). **Nome exato no LiveBridge inclui `.m3u8`**. |
| `GET` | `/api/live/transmissoes` | `GET {LB}/api/live/transmissoes` | Lista transmissões (JSON). |

Se o teu projeto Java já expõe `/api/live/hls-master` **sem** `.m3u8`, podes manter essa rota no Java e fazer proxy para **`/api/live/hls-master.m3u8`** no LiveBridge (são rotas diferentes no Node; o ficheiro oficial é com `.m3u8`).

### 2.2. HLS sob `/hls/...` (nginx MediaMTX)

O **player** (hls.js, Safari, etc.) pede URLs **relativas** vindas do master M3U8, tipicamente:

- `/hls/live/<stream>_1080/index.m3u8`
- `/hls/live/<stream>_1080/main_stream.m3u8`
- `/hls/live/<stream>_1080/<segmento>.ts`

O browser deve pedir isto **ao Java**, não ao `:8081`:

| Método | Caminho no cliente (= Java) | Proxy para LiveBridge |
|--------|------------------------------|------------------------|
| `GET` | `/hls/**` | `GET {LB}/hls/**` | Mesmo path e query. Repassar corpo binário (`.ts`) ou texto (`.m3u8`). |

**Cookie:** o nginx do LiveBridge usa `auth_request` com `vid_live`; o Java **deve** enviar o cookie `vid_live` no proxy.

**Prefixo alternativo:** se no LiveBridge estiver `LIVE_HLS_PATH_PREFIX=/api/hls`, as URLs no master passam a `/api/hls/live/...`. Nesse caso o Java também deve expor **`GET /api/hls/**`** → proxy para `{LB}/api/hls/**`.

### 2.3. Gravações (R2, lesson-boundary, HLS parcial)

| Método | Caminho no cliente (= Java) | Proxy para LiveBridge |
|--------|------------------------------|------------------------|
| `GET` | `/api/recordings` | `GET {LB}/api/recordings` | Requer R2 configurado no LB. |
| `GET` | `/api/recordings/pending` | idem | |
| `GET` | `/api/recordings/status` | idem | Query: `streamName`, opcional `session`. |
| `POST` | `/api/recordings/lesson-boundary` | idem | Body JSON (ex.: `streamName`, `folder_ids`, …). |
| `POST` | `/api/recordings/live-ended` | idem | |
| `GET` | `/api/recordings/merge-progress` | idem | Query: `path`, `session`. |
| `GET` | `/api/recordings/hls/master.m3u8` | idem | Query: `path`, `session`. **Obrigatório no BFF** — sem isto o browser recebe 404 no static handler do Spring. |
| `GET` | `/api/recordings/hls/playlist.m3u8` | idem | Query: `path`, `session`, opcional `rendition`, `token`. |
| `GET` | `/api/recordings/hls/segment` | idem | Query: `path`, `session`, `file`, etc. |
| `GET` | `/api/recordings/video` | idem | VOD / range; pode ser longo — timeouts adequados. |

**Importante:** o JSON do `lesson-boundary` devolve `hlsUrl`, `hlsMasterUrl`, `mergeProgressUrl`. Com `API_PUBLIC_BASE_URL` no LiveBridge (ou header ao proxy), esses campos vêm como `http://localhost:8080/api/recordings/...` para o browser bater no **Java**. O Java **tem** de ter estas rotas como proxy.

### 2.4. Pedidos **server-side** Java → LiveBridge (sem browser)

Quando o Java chama o LiveBridge **a partir do servidor** (ex.: `LiveBridgeRecordingService` no `POST lesson-boundary`), pode enviar:

- `X-API-Public-Base-Url: http://localhost:8080` — para o JSON devolvido ao browser já trazer URLs absolutas do BFF.

Ou configurar no contentor LiveBridge: `API_PUBLIC_BASE_URL=http://localhost:8080` (ajusta ao teu host/porta do Spring).

---

## 3. O que o front deve usar (browser)

### 3.1. Sempre contra o Java (mesma origem)

- `fetch('/api/init', { credentials: 'include' })`
- `fetch('/api/init-live', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamName, token }) })`
- URL do master HLS live: **`/api/live/hls-master.m3u8?streamName=<nome>`** no Java (ou a rota equivalente que o Java expuser, desde que faça proxy para essa rota no LB).
- **Player HLS:** configurar `xhrSetup` / base URL de forma a que os ficheiros referenciados no M3U8 (`/hls/...`) sejam pedidos ao **mesmo host do Java** (não ao `8081`). Ex.: base da app = `http://localhost:8080`, então `http://localhost:8080/hls/live/...`.

### 3.2. Não fazer em produção

- Apontar o player diretamente para `http://localhost:8081/hls/...` — outra origem: cookies `vid_live` não acompanham por defeito.
- Usar só paths relativos `/api/recordings/hls/master.m3u8` **sem** o Java ter a rota — o browser resolve no host atual; se o host for só o Java e não existir proxy, dá **404**.

### 3.3. Fluxo HLS live (resumo)

1. Obter token (ex.: `POST /api/lessons/check-live-access` no teu domínio).
2. `POST /api/init-live` com `streamName` + `token` → cookie `vid_live`.
3. `GET /api/live/hls-master.m3u8?streamName=<stream>` → master multivariante (três variantes `_1080`, `_720`, `_480`).
4. O player segue as URLs do M3U8 (`/hls/live/<stream>_1080/index.m3u8`, etc.) — **no mesmo host do Java**.
5. Cada variante: `index.m3u8` (MediaMTX) referencia `main_stream.m3u8`; depois vêm os `.ts`.

### 3.4. Fluxo após “aula acabou” (lesson-boundary)

1. `POST /api/recordings/lesson-boundary` (no Java, com proxy) → JSON com `hlsUrl`, `hlsMasterUrl`, `mergeProgressUrl`.
2. Usar essas URLs **como devolvidas** (idealmente já absolutas para o Java, ex.: `http://localhost:8080/api/recordings/hls/master.m3u8?...`).
3. Polling: `GET mergeProgressUrl` no Java.

---

## 4. Exemplo mínimo de proxy no Spring (conceitual)

Pseudo-fluxo para `GET /hls/**`:

```text
HttpServletRequest req → construir URI = livebridgeBase + req.getRequestURI() + query
→ RestTemplate/WebClient exchange(GET)
  .header("Cookie", req.getHeader("Cookie"))
→ copiar status, headers relevantes (Content-Type, Cache-Control), body para HttpServletResponse
```

Para `POST /api/recordings/lesson-boundary`: repassar body JSON e repassar a resposta JSON ao cliente (ou enriquecer no Java e já devolver ao front).

---

## 5. Checklist Java

- [ ] `GET /hls/**` e, se usado, `GET /api/hls/**` → LiveBridge nginx.
- [ ] `GET /api/live/hls-master.m3u8` → LiveBridge API.
- [ ] `POST /api/init-live`, `GET /api/init` → LiveBridge.
- [ ] `GET /api/recordings/hls/master.m3u8`, `playlist.m3u8`, `segment`, `GET .../merge-progress` → LiveBridge.
- [ ] Cookies repassados nos proxies HLS e gravações.
- [ ] (Opcional) Header `X-API-Public-Base-Url` nos pedidos servidor → LiveBridge para URLs absolutas no JSON.

---

## 6. Referência no repositório LiveBridge

| Ficheiro | Conteúdo |
|----------|-----------|
| `server/api/routes/live.js` | Rotas `/api/init`, `/api/init-live`, `/api/check-video-access`, `/api/live/hls-master.m3u8`, `/api/live/transmissoes` |
| `server/api/routes/recordings.js` | Gravações, `lesson-boundary`, HLS parcial, `merge-progress` |
| `server/nginx/nginx.conf` | `/hls/` → MediaMTX; fallback `main_stream` → `index`; auth subrequest |
| `server/api/config.js` | `LIVE_HLS_PATH_PREFIX`, `LIVE_HLS_VARIANT_PLAYLIST`, `API_PUBLIC_BASE_URL` |

---

## 7. Erros comuns

| Sintoma | Causa provável |
|---------|----------------|
| 404 em `/api/recordings/hls/master.m3u8` no Spring | Falta rota proxy no Java (vai parar a recursos estáticos). |
| hls.js **Missing Target Duration** na variante | O master ABR não pode apontar para `index.m3u8` do MediaMTX (é um segundo master, não playlist de média). No LiveBridge o default é `main_stream.m3u8` (`LIVE_HLS_VARIANT_PLAYLIST`). |
| 403 em HLS (muito cedo, com JWT ainda válido) | Cookie `vid_live` ausente ou inválido. No Express, `maxAge` do cookie está em **milissegundos**; o LiveBridge usa `VIDEO_LIVE_MAX_AGE_MS` (segundos × 1000) para alinhar às 4h. |
| 403 em HLS (outros) | `init-live` não correu, domínio/path do cookie, ou `exp` do JWT ultrapassado — renovar com novo `init-live`. |
| 404 em `main_stream.m3u8` | Mux HLS a reiniciar no MediaMTX; o nginx do LiveBridge faz fallback para `index.m3u8` quando possível. Se **ambos** falharem (corte breve da variante), o cliente pode ver 404 até o mux voltar. |
| hls.js **levelParsingError** / **media sequence mismatch** (ex.: `541255cb66ce_main_seg0` vs `efb6c9c55229_main_seg0`) | O transcoder/mux **recomeçou** uma janela HLS: novos ficheiros `*_segN.ts` com outro prefixo e outra vez `#EXT-X-MEDIA-SEQUENCE:0`. O hls.js compara com o estado do nível anterior e falha. **Não é bug do proxy Java/LB** — é recuperável no **player** (reload da fonte). |
| JSON com URLs relativas e browser chama só o Java | Configurar `API_PUBLIC_BASE_URL` no LiveBridge ou header `X-API-Public-Base-Url` no proxy servidor → LB. |

---

## 8. Recuperação no player (hls.js) após reinício do mux

Quando ocorre `LEVEL_PARSING_ERROR` / mensagem com **media sequence mismatch** em live ABR, trata como **nova geração de playlist** e volta a carregar o **mesmo** URL do master (ou destrói o `Hls` e recria). Exemplo mínimo:

```typescript
import Hls from 'hls.js';

function attachLiveRecovery(hls: Hls, masterUrl: string) {
  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.details !== Hls.ErrorDetails.LEVEL_PARSING_ERROR) return;
    const msg = String(data.error?.message ?? data.reason ?? '');
    if (!msg.includes('media sequence mismatch') && !msg.includes('levelParsingError')) return;
    try {
      hls.stopLoad();
      hls.loadSource(masterUrl);
      hls.startLoad(-1);
    } catch {
      hls.destroy();
      // recriar Hls e loadSource(masterUrl) no teu mount
    }
  });
}
```

Ajusta `masterUrl` para o URL que já usas (ex. `/api/live/hls-master.m3u8?streamName=teste` via Java). Reduzir reinícios do encoder/RTMP para a mesma variante também ajuda em produção.

---

*Documento alinhado ao comportamento do LiveBridge neste repositório; ajusta hosts e nomes de rotas Java se o teu projeto usar prefixos diferentes (`/v1/api`, etc.).*
