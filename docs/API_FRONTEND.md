# API para Frontend — Integração de Vídeo

Documentação para o frontend obter a URL do vídeo. A listagem de aulas é feita pela API Java.

**Segurança:** Com `VIDEO_ACCESS_SECRET` configurado, vídeo e live exigem token JWT obtido do Java (usuário autenticado via cookie httpOnly).

---

## Base URL

Exemplo: `https://seu-dominio.com` ou `http://IP:8081`

---

## 1. Gravações (VOD)

### Fluxo com token JWT (VIDEO_ACCESS_SECRET definido)

1. Usuário clica em "Assistir" na gravação.
2. Frontend chama **Java** com `credentials: 'include'` (cookie enviado automaticamente):

```
POST {JAVA_API_URL}/api/lessons/check-video-access
credentials: 'include'
Content-Type: application/json
Body: { "path": "live/matematica", "session": "2026-03-10_16-33-50" }
```

3. Java valida o cookie de sessão e retorna `{ "token": "<jwt>" }`.
4. Frontend monta a URL do vídeo com o token:

```
{BASE_URL}/api/recordings/video?path={path}&session={session}&token={token}
```

### Endpoint LiveBridge: `GET /api/recordings/video`

| Parâmetro | Descrição |
|-----------|-----------|
| `path` | Caminho da gravação. Ex: `live/matematica` |
| `session` | Identificador da sessão. Ex: `2026-03-10_16-33-50` |
| `token` | JWT obtido do Java (obrigatório quando VIDEO_ACCESS_SECRET está definido) |

**Exemplo:**
```
https://seu-dominio.com/api/recordings/video?path=live%2Fmatematica&session=2026-03-10_16-33-50&token=eyJhbG...
```

```javascript
// 1. Obter token do Java (com credentials para enviar cookie)
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

O vídeo suporta **seek completo**. O navegador envia requisições `Range` automaticamente.

**Erros:**
- `400` — `path` ou `session` ausentes
- `403` — Token inválido ou expirado
- `500` — Vídeo não encontrado

---

## 2. Assistir ao vivo (HLS)

### Fluxo com token JWT (VIDEO_ACCESS_SECRET definido)

1. Usuário clica em "Assistir ao vivo" (ex.: stream "matematica").
2. Frontend chama **Java** com `credentials: 'include'`:

```
POST {JAVA_API_URL}/api/lessons/check-live-access
credentials: 'include'
Content-Type: application/json
Body: { "streamName": "matematica" }
```

3. Java valida o cookie e retorna `{ "token": "<jwt>" }`.
4. Frontend chama **LiveBridge** para definir o cookie de live:

```
POST {LIVEBRIDGE_URL}/api/init-live
Content-Type: application/json
Body: { "streamName": "matematica", "token": "<jwt>" }
credentials: 'include'
```

5. Depois, carregar o HLS (o cookie é enviado automaticamente):

```javascript
const hlsUrl = `${LIVEBRIDGE_URL}/hls/live/matematica/index.m3u8`;
hls.loadSource(hlsUrl);
hls.attachMedia(videoElement);
```

### Endpoint LiveBridge: `POST /api/init-live`

| Campo | Descrição |
|-------|-----------|
| `streamName` | Nome do stream. Ex: `matematica` |
| `token` | JWT obtido do Java |

**Response:** `{ "ok": true }` — define cookie `vid_live` (4h de validade).

### URL do HLS

```
{BASE_URL}/hls/live/{NOME_DO_STREAM}/index.m3u8
```

---

## 3. Java — Endpoints a implementar

### `POST /api/lessons/check-video-access`

- Recebe `{ path, session }` no body.
- Valida cookie de sessão (usuário logado).
- Retorna `{ "token": "<jwt>" }` assinado com `VIDEO_ACCESS_SECRET`.
- Payload do JWT: `{ path, session, exp, iat }` (exp: 1h sugerido).

### `POST /api/lessons/check-live-access`

- Recebe `{ streamName }` no body.
- Valida cookie de sessão.
- Retorna `{ "token": "<jwt>" }`.
- Payload do JWT: `{ streamName, exp, iat }` (exp: 4h sugerido).

**Segredo compartilhado:** Java e LiveBridge usam o mesmo `VIDEO_ACCESS_SECRET` para assinar/validar os JWTs.

---

## 5. Listagem e metadata

### `GET /api/recordings` (LiveBridge)

Retorna gravações do R2 com metadata da API Lessons. Cada item inclui:

| Campo | Descrição |
|-------|-----------|
| `ativo` | `true` = visível para alunos, `false` = oculta. Obtido do Java; padrão `true` se ausente. |

### `PUT /api/recordings/metadata` (LiveBridge → Java)

Atualiza metadata. O campo `ativo` é sempre enviado ao Java (`true` ou `false`).

**Importante:** A API Java deve retornar `ativo` em `GET /api/lessons` e aceitar `ativo` em `PUT /api/lessons`.

**Formato da resposta `GET /api/lessons`:** O LiveBridge aceita array direto ou objeto com `content`, `data`, `lessons` ou `items`. Cada aula deve ter `id` (formato `path|session`, ex: `live/teste|2026-03-10_16-33-50`) ou `path`+`session` separados. O nome da aula em `titulo` ou `nome`.

**Servidor Linux:** `host.docker.internal` pode não funcionar. Use o IP do host (ex: `http://172.17.0.1:8080`) ou adicione `extra_hosts: ["host.docker.internal:host-gateway"]` no serviço api do docker-compose.

---

## 6. Modo legado (sem VIDEO_ACCESS_SECRET)

Quando `VIDEO_ACCESS_SECRET` não está definido:

- **Gravações:** Cookie `vid_ctx` (chamar `GET /api/init` antes).
- **Live:** Cookie `vid_ctx` (chamar `GET /api/init` antes).

O fluxo antigo continua funcionando para compatibilidade.
