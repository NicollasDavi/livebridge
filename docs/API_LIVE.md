# API LiveBridge — Live (HLS)

Documentação das rotas de transmissão ao vivo.

---

## Configuração

| Variável | Onde | Descrição |
|----------|------|-----------|
| `VIDEO_ACCESS_SECRET` | Java + LiveBridge | Segredo para assinar/validar JWTs. Use `openssl rand -hex 32` |

| Serviço | Exemplo |
|---------|---------|
| LiveBridge | `https://seu-dominio.com` ou `http://IP:8081` |
| API Java | `https://api.posihub.com.br` ou `http://localhost:8080` |

---

## Fluxo completo (com `VIDEO_ACCESS_SECRET`)

### Arquitetura direta (frontend → LiveBridge)

```
Frontend → Java check-live-access → token
Frontend → LiveBridge init-live → cookie vid_live
Frontend → LiveBridge /hls/live/.../index.m3u8 (cookie enviado)
```

### Arquitetura com proxy (posiplay — frontend → Java → LiveBridge)

```
┌──────────┐    1. POST check-live-access   ┌────────────┐
│ Frontend │ ──────────────────────────────► │ API Java   │
│          │    { streamName }               │            │
│          │    credentials: 'include'       │   2. token │
│          │ ◄──────────────────────────────│            │
└──────────┘                                 └────────────┘
     │
     │ 3. POST /api/init-live { streamName, token }
     │    Java valida JWT, define cookie vid_live (Path=/hls, 4h)
     │
     │ 4. GET /hls/live/{streamName}/**  (no Java)
     │    Cookie vid_live enviado pelo navegador
     ▼
┌────────────┐    proxyHls: repassa requisição + cookie
│ API Java   │ ─────────────────────────────────────────► LiveBridge → MediaMTX
└────────────┘
```

**Implementação Java (posiplay_api):**
- `LiveController.initLive()` — valida JWT com `VideoAccessTokenService.validateLiveToken()`, define cookie `vid_live` (Path=/hls, 4h)
- `LiveController.proxyHls()` — lê cookie da requisição, faz proxy para `{LIVEBRIDGE_URL}/hls/live/{streamName}/...`, envia cookie para o LiveBridge validar
- `HttpClient` com SSL que aceita certificados autoassinados

---

## 1. Java: `POST /api/lessons/check-live-access`

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

## 2. `POST /api/init-live`

Pode estar no **LiveBridge** (arquitetura direta) ou no **Java** (arquitetura com proxy).

**Request:**
```
POST {URL}/api/init-live
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

Define cookie `vid_live` (httpOnly, 4h). Na arquitetura com proxy, o Java usa `Path=/hls` para que o cookie seja enviado apenas em requisições `/hls/*`.

**Erros:**
| Status | Descrição |
|--------|-----------|
| 400 | `streamName` ou `token` ausentes |
| 403 | Token inválido ou expirado |

---

## 3. HLS: `GET /hls/live/{streamName}/**`

| Arquitetura | URL | Quem valida |
|-------------|-----|-------------|
| **Direta** | `{LIVEBRIDGE_URL}/hls/live/...` | LiveBridge (nginx auth_request) |
| **Proxy** | `{JAVA_API_URL}/hls/live/...` | Java repassa para LiveBridge com cookie |

**Request (proxy):**
```
GET {JAVA_API_URL}/hls/live/matematica/index.m3u8
Cookie: vid_live=<jwt>  (enviado automaticamente pelo navegador)
```

O Java lê o cookie, faz proxy para `{LIVEBRIDGE_URL}/hls/live/...` e envia o cookie. O LiveBridge valida via `auth_request` em `/api/check-video-access?stream={streamName}`.

**Response:** Playlist M3U8 e segmentos de vídeo

---

## Uso no frontend

### Arquitetura com proxy (posiplay — tudo via Java)

```javascript
const API_URL = JAVA_API_URL;  // ex: https://api.posihub.com.br

// 1. Obter token
const res = await fetch(`${API_URL}/api/lessons/check-live-access`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streamName: 'matematica' })
});
if (!res.ok) throw new Error('Sem permissão');
const { token } = await res.json();

// 2. Definir cookie (Java init-live)
await fetch(`${API_URL}/api/init-live`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ streamName: 'matematica', token })
});

// 3. Carregar HLS via proxy Java (cookie enviado automaticamente)
const hlsUrl = `${API_URL}/hls/live/matematica/index.m3u8`;
hls.loadSource(hlsUrl);
hls.attachMedia(videoElement);
```

### Arquitetura direta (frontend → LiveBridge)

```javascript
// 1. Token do Java
const { token } = await fetch(...check-live-access...).then(r => r.json());

// 2. Cookie no LiveBridge
await fetch(`${LIVEBRIDGE_URL}/api/init-live`, { ... });

// 3. HLS direto no LiveBridge
hls.loadSource(`${LIVEBRIDGE_URL}/hls/live/matematica/index.m3u8`);
```

---

## Modo legado (sem `VIDEO_ACCESS_SECRET`)

1. Frontend chama `GET /api/init` com `credentials: 'include'`
2. LiveBridge define cookie `vid_ctx`
3. Live: `GET /hls/live/{stream}/index.m3u8` (cookie enviado automaticamente)

---

## Resumo

### Arquitetura com proxy (posiplay)

| Etapa | Quem | Rota |
|-------|------|------|
| 1 | Frontend → Java | `POST /api/lessons/check-live-access` |
| 2 | Frontend → Java | `POST /api/init-live` |
| 3 | Player → Java | `GET /hls/live/{streamName}/**` → Java faz proxy para LiveBridge |

### Arquitetura direta

| Etapa | Quem | Rota |
|-------|------|------|
| 1 | Frontend → Java | `POST /api/lessons/check-live-access` |
| 2 | Frontend → LiveBridge | `POST /api/init-live` |
| 3 | Player → LiveBridge | `GET /hls/live/{streamName}/index.m3u8` |

---

## Arquitetura com proxy — requisitos e troubleshooting

### Configuração da URL no Java (posiplay_api)

| Local | Propriedade | Valor padrão |
|-------|-------------|--------------|
| `application.properties` | `livebridge.url` | `http://localhost:8081` |
| Variável de ambiente | `LIVEBRIDGE_URL` | Sobrescreve o valor acima |

**Uso no código:**
- `LiveController` (proxy HLS): `@Value("${livebridge.url:http://localhost:8081}")`
- `VideoStreamService` (proxy de gravações): mesma propriedade

**Verificar em execução:** O log já inclui `targetUrl` e `livebridgeBaseUrl` quando ocorre erro no proxy.

---

**Erro comum:** `java.net.ConnectException` em `proxyHls` → Java não consegue abrir conexão com o LiveBridge.

### O que checar (ordem prática)

| Item | Descrição |
|------|-----------|
| **URL do LiveBridge** | Host, porta e protocolo (http vs https) corretos em `application.properties` ou env |
| **Java em container** | `localhost:8081` não funciona. Use `host.docker.internal` (Windows/Mac) ou IP do host (ex.: `172.17.0.1`) ou nome do serviço Docker |
| **LiveBridge rodando** | LiveBridge está de pé e escutando na interface esperada |
| **Rede/firewall** | Porta entre Java e LiveBridge liberada |
| **HTTPS** | Se LiveBridge usa HTTPS, conferir protocolo e certificado (autoassinado pode exigir configuração extra) |

### Teste de conectividade

De dentro do mesmo ambiente do Java (mesmo host ou container):

```bash
curl http://<host-livebridge>:<porta>/hls/live/matematica/index.m3u8
```

Se falhar, o problema é rede/conectividade. Se funcionar, revisar a URL configurada no Java.
