# API LiveBridge — Rotas e Uso

Documentação completa das rotas do LiveBridge, da API Java e do fluxo de integração.

**Atualizações de performance e paginação:** [API-Integracao-Performance-e-Paginacao.md](API-Integracao-Performance-e-Paginacao.md)

---

## Índice

1. [Configuração](#configuração)
2. [Gravações (VOD)](#gravações-vod)
3. [Live (HLS)](#live-hls)
4. [Fluxo Live Ended (Aula acabou)](#fluxo-live-ended-aula-acabou)
5. [Listagem e metadata](#listagem-e-metadata)
6. [Rotas auxiliares](#rotas-auxiliares)
7. [Modo legado](#modo-legado)

---

## Configuração

### Variáveis compartilhadas

| Variável | Onde | Descrição |
|----------|------|-----------|
| `VIDEO_ACCESS_SECRET` | Java + LiveBridge | Segredo para assinar/validar JWTs. Use `openssl rand -hex 32` |

### Base URLs

| Serviço | Exemplo |
|---------|---------|
| LiveBridge | `https://seu-dominio.com` ou `http://IP:8081` |
| API Java | `https://api.posihub.com.br` ou `http://localhost:8080` |

---

## Gravações (VOD)

### Fluxo completo (com `VIDEO_ACCESS_SECRET`)

```
┌──────────┐    1. POST check-video-access   ┌────────────┐
│ Frontend │ ──────────────────────────────► │ API Java   │
│          │    { path, session }            │            │
│          │    credentials: 'include'       │   2. token │
│          │ ◄──────────────────────────────│            │
└──────────┘                                 └────────────┘
     │
     │ 3. GET /api/recordings/video?path=...&session=...&token=...
     ▼
┌──────────────┐
│ LiveBridge   │
│ (stream MP4) │
└──────────────┘
```

### 1. Java: `POST /api/lessons/check-video-access`

**Request:**
```
POST {JAVA_API_URL}/api/lessons/check-video-access
Content-Type: application/json
Cookie: <sessão do usuário>
Body: { "path": "live/matematica", "session": "2026-03-10_16-33-50" }
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `path` | string | sim | Caminho da gravação. Ex: `live/matematica` |
| `session` | string | sim | Identificador da sessão. Ex: `2026-03-10_16-33-50` |

**Response 200:**
```json
{ "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

**Fluxo interno:**
1. Validar cookie de sessão (usuário logado)
2. Se inválido → `403`
3. Gerar JWT: `{ path, session, exp: now+3600, iat: now }`
4. Assinar com `VIDEO_ACCESS_SECRET` (HS256)
5. Retornar `{ "token": "<jwt>" }`

**Exemplo Java (jjwt):**
```java
String token = Jwts.builder()
    .claim("path", path)
    .claim("session", session)
    .issuedAt(Instant.now())
    .expiration(Instant.now().plusSeconds(3600))
    .signWith(Keys.hmacShaKeyFor(VIDEO_ACCESS_SECRET.getBytes(StandardCharsets.UTF_8)))
    .compact();
return ResponseEntity.ok(Map.of("token", token));
```

---

### 2. LiveBridge: `GET /api/recordings/video`

**Request:**
```
GET {LIVEBRIDGE_URL}/api/recordings/video?path={path}&session={session}&token={token}
```

| Parâmetro | Descrição |
|-----------|-----------|
| `path` | Caminho da gravação. Ex: `live/matematica` |
| `session` | Identificador da sessão. Ex: `2026-03-10_16-33-50` |
| `token` | JWT obtido do Java (obrigatório quando `VIDEO_ACCESS_SECRET` está definido) |

**Exemplo de URL:**
```
https://seu-dominio.com/api/recordings/video?path=live%2Fmatematica&session=2026-03-10_16-33-50&token=eyJhbG...
```

**Response:** Stream de vídeo MP4 (200 ou 206 com Range)

**Erros:**
| Status | Descrição |
|--------|-----------|
| 400 | `path` ou `session` ausentes |
| 403 | Token inválido ou expirado |
| 500 | Vídeo não encontrado no R2 |

**Uso no frontend:**
```javascript
// 1. Obter token do Java
const res = await fetch(`${JAVA_API_URL}/api/lessons/check-video-access`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path, session })
});
if (!res.ok) throw new Error('Sem permissão');
const { token } = await res.json();

// 2. Montar URL do vídeo
const videoUrl = `${LIVEBRIDGE_URL}/api/recordings/video?path=${encodeURIComponent(path)}&session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}`;

// 3. Usar no elemento video
<video src={videoUrl} controls playsInline crossOrigin="use-credentials" />
```

O vídeo suporta **seek completo** (Range requests).

---

## Live (HLS)

### Fluxo completo (com `VIDEO_ACCESS_SECRET`)

```
┌──────────┐    1. POST check-live-access   ┌────────────┐
│ Frontend │ ──────────────────────────────► │ API Java   │
│          │    { streamName }               │            │
│          │    credentials: 'include'       │   2. token │
│          │ ◄──────────────────────────────│            │
└──────────┘                                 └────────────┘
     │
     │ 3. POST /api/init-live { streamName, token }
     │    credentials: 'include'
     ▼
┌──────────────┐
│ LiveBridge   │  Define cookie vid_live
└──────────────┘
     │
     │ 4. GET /hls/live/{streamName}/index.m3u8
     │    Cookie enviado automaticamente
     ▼
┌──────────────┐
│ MediaMTX     │  Stream HLS
└──────────────┘
```

### 1. Java: `POST /api/lessons/check-live-access`

**Request:**
```
POST {JAVA_API_URL}/api/lessons/check-live-access
Content-Type: application/json
Cookie: <sessão do usuário>
Body: { "streamName": "matematica" }
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `streamName` | string | sim | Nome do stream. Ex: `matematica` |

**Response 200:**
```json
{ "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

**Fluxo interno:**
1. Validar cookie de sessão
2. Se inválido → `403`
3. Gerar JWT: `{ streamName, exp: now+14400, iat: now }` (4h)
4. Assinar com `VIDEO_ACCESS_SECRET` (HS256)
5. Retornar `{ "token": "<jwt>" }`

**Exemplo Java (jjwt):**
```java
String token = Jwts.builder()
    .claim("streamName", streamName)
    .issuedAt(Instant.now())
    .expiration(Instant.now().plusSeconds(14400))
    .signWith(Keys.hmacShaKeyFor(VIDEO_ACCESS_SECRET.getBytes(StandardCharsets.UTF_8)))
    .compact();
return ResponseEntity.ok(Map.of("token", token));
```

---

### 2. LiveBridge: `POST /api/init-live`

**Request:**
```
POST {LIVEBRIDGE_URL}/api/init-live
Content-Type: application/json
credentials: 'include'
Body: { "streamName": "matematica", "token": "<jwt>" }
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `streamName` | string | sim | Nome do stream |
| `token` | string | sim | JWT obtido do Java |

**Response 200:**
```json
{ "ok": true }
```

Define cookie `vid_live` (httpOnly, 4h de validade).

**Erros:**
| Status | Descrição |
|--------|-----------|
| 400 | `streamName` ou `token` ausentes |
| 403 | Token inválido ou expirado |

---

### 3. LiveBridge: `GET /hls/live/{streamName}/index.m3u8`

**Request:**
```
GET {LIVEBRIDGE_URL}/hls/live/matematica/index.m3u8
Cookie: vid_live=<jwt>  (enviado automaticamente pelo navegador)
```

**Proteção:** Nginx usa `auth_request` em `/api/check-video-access?stream={streamName}`. O cookie `vid_live` é validado antes de liberar o HLS.

**Response:** Playlist M3U8 e segmentos de vídeo

---

**Uso no frontend:**
```javascript
// 1. Obter token do Java
const res = await fetch(`${JAVA_API_URL}/api/lessons/check-live-access`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streamName: 'matematica' })
});
if (!res.ok) throw new Error('Sem permissão');
const { token } = await res.json();

// 2. Definir cookie no LiveBridge
await fetch(`${LIVEBRIDGE_URL}/api/init-live`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streamName: 'matematica', token })
});

// 3. Carregar HLS (cookie enviado automaticamente)
const hlsUrl = `${LIVEBRIDGE_URL}/hls/live/matematica/index.m3u8`;
hls.loadSource(hlsUrl);
hls.attachMedia(videoElement);
```

---

## Fluxo Live Ended (Aula acabou)

Quando o operador clica em "Aula acabou" durante a live, o servidor descobre o `path` e `session` no disco, dispara o merge em background e registra o vídeo na API de Vídeos ao concluir.

### Fluxo completo

```
┌──────────┐  POST /api/recordings/live-ended   ┌────────────┐
│ Frontend │  { streamName: "matematica" }      │ LiveBridge │
│          │ ─────────────────────────────────► │ API       │
│          │                                     │            │
│          │  GET /api/recordings/status         │ Descobre   │
│          │  ?streamName=matematica (polling)   │ path/session
│          │ ◄─────────────────────────────────│ Chama merge
└──────────┘                                     └─────┬──────┘
                                                       │
                                                       ▼
                                               ┌──────────────┐
                                               │ Merge        │
                                               │ Concat+Upload│
                                               └──────┬───────┘
                                                      │
                                                      │ POST /api/recordings/upload-complete
                                                      ▼
                                               ┌──────────────┐
                                               │ API          │
                                               │ POST /api/videos
                                               └──────────────┘
```

### 1. LiveBridge: `POST /api/recordings/live-ended`

**Request:**
```
POST {LIVEBRIDGE_URL}/api/recordings/live-ended
Content-Type: application/json
Body: { "streamName": "matematica" }
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `streamName` | string | sim | Nome do stream. Ex: `matematica` |

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

**Erros:**
| Status | Descrição |
|--------|-----------|
| 400 | `streamName` ausente |
| 404 | Nenhuma sessão de gravação ativa encontrada |

---

### 2. LiveBridge: `GET /api/recordings/status`

**Request:**
```
GET {LIVEBRIDGE_URL}/api/recordings/status?streamName=matematica
```

| Parâmetro | Descrição |
|-----------|-----------|
| `streamName` | Nome do stream (obrigatório) |

**Response 200 (exemplos):**

| status | Descrição |
|--------|-----------|
| `live` | Gravando em andamento |
| `processing` | Compactando e enviando para R2 |
| `ready` | Pronto; `videoPath` disponível |
| `no_session` | Nenhuma sessão ativa |

```json
{
  "path": "live/matematica",
  "session": "2025-03-09_16-33-50",
  "status": "ready",
  "videoPath": "live/matematica/2025-03-09_16-33-50.mp4",
  "message": "Pronto"
}
```

**Uso no frontend (polling):**
```javascript
const pollStatus = async () => {
  const res = await fetch(`${LIVEBRIDGE_URL}/api/recordings/status?streamName=matematica`);
  const data = await res.json();
  if (data.status === 'ready') {
    console.log('Vídeo pronto:', data.videoPath);
    return;
  }
  if (data.status === 'processing') setTimeout(pollStatus, 3000);
};
```

---

### 3. LiveBridge: `POST /api/recordings/upload-complete` (interno)

Chamado pelo serviço Merge quando o upload para R2 conclui. Registra o vídeo na API de Vídeos com `path` completo (ex.: `live/matematica/2025-03-09_16-33-50.mp4`).

**Variáveis de ambiente necessárias:**
| Variável | Descrição |
|----------|-----------|
| `VIDEOS_API_URL` | URL da API de Vídeos |
| `VIDEOS_API_TOKEN` | Token para `POST /api/videos` |

---

## Listagem e metadata

### LiveBridge: `GET /api/recordings`

**Request:**
```
GET {LIVEBRIDGE_URL}/api/recordings
```

**Autenticação:** Cookie `vid_ctx` (chamado automaticamente após `GET /api/init` ou ao listar gravações)

**Response 200:**
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

| Campo | Descrição |
|-------|-----------|
| `path` | Caminho da gravação |
| `session` | Identificador da sessão |
| `id` | `path|session` |
| `ativo` | `true` = visível para alunos, `false` = oculta. Obtido da API Lessons |

---

### LiveBridge: `PUT /api/recordings/metadata`

**Request:**
```
PUT {LIVEBRIDGE_URL}/api/recordings/metadata
Content-Type: application/json
Body: {
  "id": "live/matematica|2026-03-10_16-33-50",
  "numero": 1,
  "nome": "Aula de Matemática",
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
| `id` | sim | `path|session` |
| `ativo` | sim | Sempre enviado pelo LiveBridge |
| `nome`, `numero`, etc. | não | Demais campos de metadata |

**Response 200:**
```json
{ "ok": true, "aula": { ... } }
```

---

### LiveBridge: `PUT /api/recordings/name`

**Request:**
```
PUT {LIVEBRIDGE_URL}/api/recordings/name
Content-Type: application/json
Body: { "id": "live/matematica|2026-03-10_16-33-50", "name": "Novo nome" }
```

---

## Rotas auxiliares

### LiveBridge: `GET /api/init`

**Request:**
```
GET {LIVEBRIDGE_URL}/api/init
credentials: 'include'
```

**Response 200:**
```json
{ "ok": true }
```

Define cookie `vid_ctx` (usado em modo legado e para listagem de gravações).

---

### LiveBridge: `GET /api/professores`, `/api/materias`, `/api/frentes`, `/api/cursos`

**Request:**
```
GET {LIVEBRIDGE_URL}/api/professores
GET {LIVEBRIDGE_URL}/api/materias
GET {LIVEBRIDGE_URL}/api/frentes
GET {LIVEBRIDGE_URL}/api/cursos
```

**Response 200:** Array de objetos `{ nome: "..." }`

Proxy para `GET /api/lessons/distinct/{campo}` da API Lessons.

---

## Modo legado (sem `VIDEO_ACCESS_SECRET`)

Quando `VIDEO_ACCESS_SECRET` **não** está definido:

| Recurso | Autenticação |
|---------|--------------|
| **Gravações** | Cookie `vid_ctx` (chamar `GET /api/init` antes) |
| **Live** | Cookie `vid_ctx` (chamar `GET /api/init` antes) |

**Fluxo simplificado:**
1. Frontend chama `GET /api/init` com `credentials: 'include'`
2. LiveBridge define cookie `vid_ctx`
3. Gravações: `GET /api/recordings/video?path=...&session=...` (sem token)
4. Live: `GET /hls/live/{stream}/index.m3u8` (cookie enviado automaticamente)

---

## Resumo: quem chama o quê

| Ação | Frontend chama | Java chama |
|------|---------------|------------|
| **Assistir gravação** | Java → check-video-access → token | — |
| | LiveBridge → /api/recordings/video?token=... | — |
| **Assistir live** | Java → check-live-access → token | — |
| | LiveBridge → /api/init-live | — |
| | LiveBridge → /hls/live/.../index.m3u8 | — |
| **Listar gravações** | LiveBridge → /api/recordings | — |
| **Atualizar metadata** | LiveBridge → /api/recordings/metadata | — |
| | (LiveBridge → Java PUT /api/lessons) | — |

O Java **não chama** o LiveBridge. O Java apenas gera tokens; o frontend usa esses tokens nas requisições ao LiveBridge.
