# LiveBridge — Integração: performance, logs e paginação

Documento para **frontends, API Java e operação**: alterações que afetam integração ou comportamento observável da API HTTP do LiveBridge.

**Relacionado:** [API_Rotas_Completo.md](API_Rotas_Completo.md), [API_ROUTES.md](API_ROUTES.md), [Frontend-Externo.md](Frontend-Externo.md).

---

## 1. Resumo das mudanças

| Área | O que mudou |
|------|-------------|
| **Logs HTTP** | Por defeito **não** se regista cada pedido a `/api/check-video-access` nem a `/api/recordings/hls/segment` (reduz ruído e CPU em live com muitos segmentos). |
| **CORS** | Origens permitidas passam a ser consultadas com `Set` (O(1) por pedido). |
| **`GET /api/recordings`** | Modo opcional **`paginate=1`** com corpo JSON **objeto** (`items`, `nextCursor`, …). Sem `paginate`, resposta continua a ser **array** (compatível com código existente). |
| **`GET /api/recordings/pending`** | Leitura dos ficheiros JSON em **paralelo** (concorrência configurável); o formato do **array** de resposta mantém-se. |
| **Merge (serviço interno)** | Menos clones profundos no JSON de progresso; diretório `merge-progress` criado uma vez por ciclo de escrita otimizado. |

---

## 2. Variáveis de ambiente (API)

| Variável | Default | Descrição |
|----------|---------|-----------|
| `API_LOG_ALL_REQUESTS` | `0` | Se `1` ou `true`, volta a logar **todas** as rotas, incluindo `check-video-access` e segmentos HLS. |
| `CHECK_VIDEO_ACCESS_CACHE_MS` | `1500` | TTL (ms) do cache em memória para respostas **200** de `GET /api/check-video-access` (só sucessos). |
| `RECORDINGS_PAGE_MAX_KEYS` | `500` | Teto por defeito de `maxKeys` em `GET /api/recordings?paginate=1` (máximo absoluto 1000 — limite S3). |
| `PENDING_READ_CONCURRENCY` | `8` | Número máximo de leituras de ficheiro em paralelo em `GET /api/recordings/pending`. |

No Docker Compose, estas variáveis podem ser passadas no serviço `api` (ver `server/docker-compose.yml`).

---

## 3. `GET /api/recordings` — modo paginado

### 3.1 Quando usar

- Buckets R2 com **muitos** objetos: a lista completa obriga a percorrer todas as chaves; a paginação reduz memória e tempo do **primeiro** ecrã.
- Quando a ordem global idêntica à lista completa **não** é obrigatória entre páginas.

### 3.2 Contrato

**Pedido (primeira página):**

```http
GET /api/recordings?paginate=1
GET /api/recordings?paginate=1&maxKeys=300
```

| Query | Obrigatório | Descrição |
|-------|-------------|-----------|
| `paginate` | sim (`1` ou `true`) | Ativa o modo objeto; sem isto, a resposta é o **array** clássico. |
| `maxKeys` | não | Chaves máximas por chamada `ListObjectsV2` (1–1000). Omite-se → `RECORDINGS_PAGE_MAX_KEYS`. |
| `cursor` | não | Token opaco da página anterior (`nextCursor`). Codificação interna: Base64 URL do continuation token S3. |

**Resposta 200:**

```json
{
  "items": [ /* mesmo formato de cada elemento do array clássico */ ],
  "nextCursor": "eyJ...base64url...",
  "maxKeys": 500,
  "paginated": true,
  "note": "Ordem e cortes seguem uma página do ListObjects R2; para lista completa ordenada como antes, omita paginate=1."
}
```

- **`nextCursor`:** `null` quando não há mais páginas.
- **`items`:** entradas `.mp4` mapeadas como no modo clássico, enriquecidas com Lessons quando configurado.
- **Ordem:** dentro de cada página aplica-se a mesma ordenação por `session` / variante que no modo clássico; **entre** páginas a ordem segue a **paginação do R2**, não a lista global materializada.

### 3.3 Migração no frontend

```javascript
// Modo clássico (inalterado)
const all = await fetch('/api/recordings', { credentials: 'include' }).then((r) => r.json());
if (Array.isArray(all)) {
  /* usar all como antes */
}

// Modo paginado
let cursor = null;
const acc = [];
do {
  const q = new URLSearchParams({ paginate: '1', maxKeys: '500' });
  if (cursor) q.set('cursor', cursor);
  const body = await fetch(`/api/recordings?${q}`, { credentials: 'include' }).then((r) => r.json());
  acc.push(...body.items);
  cursor = body.nextCursor;
} while (cursor);
```

### 3.4 API Java

Nenhuma alteração obrigatória na Java: o fluxo de tokens e cookies para o player **não** muda. Se a Java **proxy** ou **agrega** `GET /api/recordings`, deve aceitar **tanto** array **como** objeto quando repassar `paginate=1`.

---

## 4. `GET /api/recordings/pending`

- Formato JSON de cada elemento: **igual** ao documentado historicamente.
- Implementação: leitura paralela dos ficheiros em `live-ended/` com limite `PENDING_READ_CONCURRENCY` para reduzir latência com muitas entradas.

---

## 5. Logs e observabilidade

- Com `API_LOG_ALL_REQUESTS=0` (padrão), o middleware de log **omite**:
  - `GET /api/check-video-access`
  - `GET /api/recordings/hls/segment`
- Para depuração de nginx `auth_request` ou de segmentos, ativar `API_LOG_ALL_REQUESTS=1`.

---

## 6. Serviço Merge (referência)

Não expõe API pública ao browser da mesma forma que a API `:3000`; melhorias internas:

- Throttle de escrita do ficheiro de progresso (já existente).
- Snapshot de variantes com menos `structuredClone` entre ticks.
- Evitar `existsSync` repetido no diretório `merge-progress` após criação.

Variáveis já documentadas em `README` / `DOCUMENTACAO_TECNICA`: `MERGE_ENCODE_CONCURRENCY`, `MERGE_PROGRESS_THROTTLE_MS`, etc.

---

## 7. Changelog (integração)

| Data | Alteração |
|------|-----------|
| 2026-03-28 | Introdução de `GET /api/recordings?paginate=1`, novas envs de API, log seletivo, `pending` paralelo; documento criado. |
