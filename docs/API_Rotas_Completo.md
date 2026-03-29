# LiveBridge API — Todas as Rotas

Base URL: `http://localhost:8081` (porta 8081)

---

## 1. `GET /api/init`

**Descrição:** Define o cookie `vid_ctx` necessário para acessar a listagem de gravações e outras rotas que exigem autenticação legada.

**Quando usar:** Antes de chamar `GET /api/recordings` ou outras rotas que usam cookie.

**Request:**
```
GET http://localhost:8081/api/init
```

**Headers:** Nenhum obrigatório. Use `credentials: 'include'` para o navegador enviar/receber cookies.

**Response 200:**
```json
{ "ok": true }
```

**Uso no frontend:**
```javascript
await fetch('http://localhost:8081/api/init', { credentials: 'include' });
```

---

## 2. `GET /api/check-video-access`

**Descrição:** Rota interna usada pelo Nginx para validar acesso ao HLS. Não deve ser chamada diretamente pelo frontend.

**Query:** `?stream=nome_do_stream`

**Autenticação:** Cookie `vid_live` (JWT) ou `vid_ctx` (legado).

---

## 3. `POST /api/init-live`

**Descrição:** Define o cookie `vid_live` para permitir acesso ao stream HLS. O token JWT deve ser obtido da API Java (`POST /api/lessons/check-live-access`).

**Quando usar:** Antes de carregar o HLS de uma live. O cookie é enviado automaticamente nas requisições subsequentes ao mesmo domínio.

**Request:**
```
POST http://localhost:8081/api/init-live
Content-Type: application/json
```

**Body:**
```json
{
  "streamName": "matematica",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| streamName | string | sim | Nome do stream (ex.: matematica) |
| token | string | sim | JWT obtido do Java |

**Response 200:**
```json
{ "ok": true }
```

**Erros:** 400 (campos ausentes), 403 (token inválido)

**Uso:**
```javascript
// 1. Obter token do Java
const tokenRes = await fetch('http://localhost:8080/api/lessons/check-live-access', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streamName: 'matematica' })
});
const { token } = await tokenRes.json();

// 2. Definir cookie no LiveBridge
await fetch('http://localhost:8081/api/init-live', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streamName: 'matematica', token })
});

// 3. Carregar HLS (cookie enviado automaticamente)
// GET http://localhost:8081/hls/live/matematica/index.m3u8
```

---

## 4. `GET /api/recordings`

**Descrição:** Lista os vídeos `.mp4` no bucket R2, com metadata da API Lessons (nome, professor, matéria, etc.) quando disponível.

**Quando usar:** Para exibir a lista de gravações disponíveis para assistir.

**Modo lista completa (comportamento clássico):** corpo da resposta é um **array JSON** — igual ao histórico do projeto.

**Request:**
```
GET http://localhost:8081/api/recordings
```

**Modo paginado (opcional, buckets muito grandes):** uma página por pedido `ListObjects` no R2; ver **[API — Performance, logs e paginação](API-Integracao-Performance-e-Paginacao.md)**.

```
GET http://localhost:8081/api/recordings?paginate=1&maxKeys=500&cursor={opcional}
```

**Antes:** Chamar `GET /api/init` para definir o cookie.

**Response 200 (modo clássico):**
```json
[
  {
    "path": "live/matematica",
    "session": "2026-03-10_16-33-50",
    "id": "live/matematica|2026-03-10_16-33-50",
    "date": "2026-03-10 16:33:50",
    "name": "Aula de Matemática",
    "numero": 1,
    "assunto": "Álgebra",
    "professor": "João",
    "materia": "Matemática",
    "frente": "1",
    "cursos": ["Medicina"],
    "ativo": true
  }
]
```

**Response 200 (modo `paginate=1`):** objeto com `items`, `nextCursor`, `maxKeys`, `paginated`, `note` — **não** é um array na raiz; o cliente deve concatenar páginas usando `nextCursor`.

**Uso:**
```javascript
await fetch('http://localhost:8081/api/init', { credentials: 'include' });
const res = await fetch('http://localhost:8081/api/recordings', { credentials: 'include' });
const videos = await res.json(); // array no modo clássico
```

**Erros:** 503 (R2 não configurado)

---

## 5. `GET /api/recordings/video`

**Descrição:** Stream do vídeo. Se ainda em processamento (.ts no servidor), redireciona (302) para o HLS. Se pronto no R2, retorna o MP4. A API Java não precisa diferenciar — sempre usa esta URL.

**Quando usar:** Para reproduzir uma gravação no elemento `<video>`.

**Request:**
```
GET http://localhost:8081/api/recordings/video?path={path}&session={session}&token={token}
```

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| path | sim | Ex.: `live/matematica` |
| session | sim | Ex.: `2026-03-10_16-33-50` |
| token | sim* | JWT obtido do Java (`POST /api/lessons/check-video-access`) |

*Quando `VIDEO_ACCESS_SECRET` está definido no LiveBridge.

**Response:** Stream de vídeo (200 ou 206 com Range)

**Uso:**
```javascript
// 1. Obter token do Java
const tokenRes = await fetch('http://localhost:8080/api/lessons/check-video-access', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: 'live/matematica', session: '2026-03-10_16-33-50' })
});
const { token } = await tokenRes.json();

// 2. URL do vídeo
const url = `http://localhost:8081/api/recordings/video?path=${encodeURIComponent('live/matematica')}&session=${encodeURIComponent('2026-03-10_16-33-50')}&token=${encodeURIComponent(token)}`;

// 3. Usar no video
<video src={url} controls />
```

**Erros:** 400 (path/session ausentes), 403 (token inválido), 500 (vídeo não encontrado)

---

## 6. `PUT /api/recordings/name`

**Descrição:** Atualiza apenas o nome de uma gravação. Proxy para a API Lessons.

**Request:**
```
PUT http://localhost:8081/api/recordings/name
Content-Type: application/json
```

**Body:**
```json
{
  "id": "live/matematica|2026-03-10_16-33-50",
  "name": "Aula 1 - Funções"
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| id | sim | `path|session` |
| name | não | Novo nome (null para limpar) |

**Response 200:** `{ "ok": true, "name": "Aula 1 - Funções" }`

**Erros:** 400 (id ausente), 503 (API Lessons não configurada)

---

## 7. `PUT /api/recordings/metadata`

**Descrição:** Atualiza metadata completa da gravação. Proxy para a API Lessons.

**Request:**
```
PUT http://localhost:8081/api/recordings/metadata
Content-Type: application/json
```

**Body:**
```json
{
  "id": "live/matematica|2026-03-10_16-33-50",
  "numero": 1,
  "nome": "Aula de Funções",
  "assunto": "Álgebra",
  "professor": "João",
  "materia": "Matemática",
  "frente": "1",
  "cursos": ["Medicina"],
  "ativo": true
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| id | sim | `path|session` |
| numero, nome, assunto, professor, materia, frente, cursos, ativo | não | Campos de metadata |

**Response 200:** `{ "ok": true, "aula": {...} }`

---

## 8. `DELETE /api/recordings`

**Descrição:** Remove o vídeo do bucket R2.

**Request:**
```
DELETE http://localhost:8081/api/recordings
Content-Type: application/json
```

**Body:**
```json
{
  "path": "live/matematica",
  "session": "2026-03-10_16-33-50"
}
```

Ou via query: `?path=live/matematica&session=2026-03-10_16-33-50`

**Response 200:** `{ "ok": true, "message": "Vídeo removido" }`

**Erros:** 400 (path/session ausentes), 503 (R2 não configurado)

---

## 9. `POST /api/recordings/live-ended`

**Descrição:** Finaliza a gravação da live. Descobre path/session no disco, registra o vídeo na API de Vídeos (Java), dispara o merge em background. O vídeo é criado como "aula" na API Java antes de subir para o R2.

**Quando usar:** Quando o operador clica em "Aula acabou" durante a transmissão.

**Request:**
```
POST http://localhost:8081/api/recordings/live-ended
Content-Type: application/json
```

**Body:**
```json
{
  "streamName": "matematica",
  "name": "live/matematica/2025-03-09_16-33-50.mp4",
  "materia": "Matemática",
  "n_aula": 1,
  "frente": "Exatas",
  "professor": "João",
  "folder_ids": ["uuid-pasta"],
  "course_ids": ["uuid-curso"]
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| streamName | sim | Nome do stream |
| name, materia, n_aula, frente, professor, folder_ids, course_ids | não | Metadados para a API de Vídeos |

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

**Erros:** 400 (streamName ausente), 404 (nenhuma sessão ativa)

---

## 9b. `POST /api/recordings/lesson-boundary` — "Aula acabou" (parte da live)

**Descrição:** Salva **uma parte** da live. **1ª vez:** do início até agora. **2ª vez:** do 1º click até o 2º. **3ª vez:** do 2º até o 3º. A live continua. Enquanto compacta e sobe pro R2, o vídeo em `.ts` fica disponível via HLS.

**Quando usar:** Quando o operador clica em "Aula acabou" durante uma live que tem várias aulas em sequência. Cada clique gera uma gravação separada (só o trecho desde o último click).

**Request:**
```
POST http://localhost:8081/api/recordings/lesson-boundary
Content-Type: application/json
```

**Body:** Igual a `live-ended` (streamName, name, materia, n_aula, frente, professor, folder_ids, course_ids).

**Response 200:**
```json
{
  "ok": true,
  "path": "live/matematica",
  "session": "2025-03-09_17-15-00_aula",
  "status": "processing",
  "message": "Aula registrada…",
  "hlsUrl": "/api/recordings/hls/playlist.m3u8?path=live%2Fmatematica&session=2025-03-09_17-15-00_aula",
  "mergeProgressUrl": "/api/recordings/merge-progress?path=live%2Fmatematica&session=2025-03-09_17-15-00_aula"
}
```

**Fluxo:** Copia os `.ts` do trecho → pasta `_aula` → merge (compacta + upload R2) → **apaga** pasta `_aula`, **apaga os mesmos `.ts` na pasta do stream** (flat) e **zera** `recordings/boundaries/{stream}.json`. Não é obrigatório chamar `live-ended` para cada aula. `hlsUrl` + `mergeProgressUrl` para o frontend.

---

## 10. `GET /api/recordings/pending`

**Descrição:** Lista entradas ainda presentes em `recordings/live-ended/*.json` — em processamento ou com falha. **Quando o vídeo sobe ao R2, o JSON correspondente é removido** (não aparece mais aqui).

**Quando usar:** Para exibir no frontend as aulas que acabaram de finalizar, com status "Compactando e enviando..." até ficarem prontas.

**Request:**
```
GET http://localhost:8081/api/recordings/pending
```

**Response 200:**
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
  },
  {
    "streamName": "fisica",
    "path": "live/fisica",
    "session": "2025-03-09_15-00-00",
    "status": "ready",
    "videoPath": "live/fisica/2025-03-09_15-00-00.mp4",
    "endedAt": "2025-03-09T15:05:00.000Z",
    "updatedAt": "2025-03-09T15:08:00.000Z"
  }
]
```

| Campo | Descrição |
|-------|-----------|
| status | `processing` (compactando/enviando) ou `ready` (já no R2) |
| videoPath | Preenchido quando `status === 'ready'` |
| hlsUrl | Para gravações parciais em `processing`: URL do HLS para assistir em `.ts` enquanto compacta |
| mergeProgressUrl | Em `processing`: polling de percentual e ETA do merge |

---

## 10d. `GET /api/recordings/merge-progress`

**Descrição:** Retorna o progresso da compactação (ffmpeg) e do upload para o R2 para um `path` + `session` específicos (o mesmo retornado por `lesson-boundary` ou `live-ended`).

**Request:**
```
GET http://localhost:8081/api/recordings/merge-progress?path=live/matematica&session=2025-03-09_17-15-00_aula
```

**Response 200 (em andamento):**
```json
{
  "path": "live/matematica",
  "session": "2025-03-09_17-15-00_aula",
  "phase": "encoding",
  "percentOverall": 42,
  "encodingPercent": 55,
  "uploadPercent": 0,
  "currentTimeSec": 180.5,
  "durationSec": 600,
  "etaSecondsEncoding": 120,
  "etaSecondsOverall": 150,
  "bytesUploaded": 0,
  "bytesTotal": null,
  "message": "Compactando vídeo…",
  "updatedAt": "2025-03-09T17:16:00.000Z"
}
```

| phase | Significado |
|-------|-------------|
| encoding | ffmpeg em execução |
| uploading | envio multipart para R2 |
| done | concluído (arquivo some após alguns minutos) |
| failed | erro |
| idle | sem job (resposta quando não há JSON de progresso) |

**Nota:** `percentOverall` usa ~75% para encode e ~25% para upload. ETA é estimativa.

---

## 10b. `GET /api/recordings/hls/playlist.m3u8` — HLS para gravação em processamento

**Descrição:** Retorna a playlist M3U8 de uma gravação que ainda está em `.ts` (antes de subir pro R2). Usado para reproduzir via hls.js enquanto o merge processa.

**Request:**
```
GET http://localhost:8081/api/recordings/hls/playlist.m3u8?path=live/matematica&session=2025-03-09_17-15-00_aula&token=...
```

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| path | sim | Path da gravação (ex: live/matematica) |
| session | sim | Session (ex: 2025-03-09_17-15-00_aula) |
| token | não | JWT para autenticação (ou cookie vid_ctx) |

**Response 200:** Playlist M3U8 (Content-Type: application/vnd.apple.mpegurl)

---

## 10c. `GET /api/recordings/hls/segment` — Segmento .ts individual

**Descrição:** Serve um segmento `.ts` individual. Chamado automaticamente pelo player ao seguir a playlist M3U8.

**Request:**
```
GET http://localhost:8081/api/recordings/hls/segment?path=...&session=...&file=2025-03-09_17-15-00-123456.ts&token=...
```

---

## 11. `GET /api/recordings/status`

**Descrição:** Retorna o status de uma gravação específica (por streamName). Com `session` (ex: `2025-03-09_17-15-00_aula`), retorna status de gravação parcial. Usado para polling após chamar `live-ended` ou `lesson-boundary`.

**Request:**
```
GET http://localhost:8081/api/recordings/status?streamName=matematica
GET http://localhost:8081/api/recordings/status?streamName=matematica&session=2025-03-09_17-15-00_aula
```

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| streamName | sim | Nome do stream |
| session | não | Para gravação parcial (lesson-boundary): session com sufixo _aula |

**Response 200 (exemplos):**

| status | Significado |
|--------|-------------|
| live | Gravando em andamento |
| processing | Compactando e enviando para R2 |
| ready | Pronto; vídeo no R2 |
| no_session | Nenhuma sessão ativa |

```json
{
  "path": "live/matematica",
  "session": "2025-03-09_16-33-50",
  "status": "ready",
  "videoPath": "live/matematica/2025-03-09_16-33-50.mp4",
  "message": "Pronto"
}
```

**Uso (polling):**
```javascript
const poll = async () => {
  const res = await fetch('http://localhost:8081/api/recordings/status?streamName=matematica');
  const data = await res.json();
  if (data.status === 'ready') return data;
  await new Promise(r => setTimeout(r, 3000));
  return poll();
};
```

---

## 12. `POST /api/recordings/upload-complete`

**Descrição:** Rota interna chamada pelo serviço Merge quando o upload para R2 conclui. Não deve ser chamada pelo frontend.

---

## 13. `GET /api/professores`

**Descrição:** Lista professores distintos. Proxy para a API Lessons (`/api/lessons/distinct/professores`).

**Request:** `GET http://localhost:8081/api/professores`

**Response 200:** `[{ "nome": "João" }, ...]`

---

## 14. `GET /api/materias`

**Descrição:** Lista matérias distintas. Proxy para a API Lessons.

**Request:** `GET http://localhost:8081/api/materias`

**Response 200:** `[{ "nome": "Matemática" }, ...]`

---

## 15. `GET /api/frentes`

**Descrição:** Lista frentes distintas. Proxy para a API Lessons.

**Request:** `GET http://localhost:8081/api/frentes`

**Response 200:** `[{ "nome": "Exatas" }, ...]`

---

## 16. `GET /api/cursos`

**Descrição:** Lista cursos distintos. Proxy para a API Lessons.

**Request:** `GET http://localhost:8081/api/cursos`

**Response 200:** `[{ "nome": "Medicina" }, ...]`

---

## Resumo

| Método | Rota | Uso |
|--------|------|-----|
| GET | /api/init | Cookie para listagem |
| POST | /api/init-live | Cookie para HLS |
| GET | /api/recordings | Listar vídeos do R2 |
| GET | /api/recordings/video | Stream MP4 |
| PUT | /api/recordings/name | Atualizar nome |
| PUT | /api/recordings/metadata | Atualizar metadata |
| DELETE | /api/recordings | Excluir vídeo |
| POST | /api/recordings/live-ended | Finalizar live inteira |
| POST | /api/recordings/lesson-boundary | Salvar parte da live (aula acabou, live continua) |
| GET | /api/recordings/merge-progress | % compactação + upload + ETA |
| GET | /api/recordings/hls/playlist.m3u8 | HLS para gravação em .ts (enquanto processa) |
| GET | /api/recordings/pending | Aulas em processamento |
| GET | /api/recordings/status | Status por stream |
| GET | /api/professores | Lista professores |
| GET | /api/materias | Lista matérias |
| GET | /api/frentes | Lista frentes |
| GET | /api/cursos | Lista cursos |
