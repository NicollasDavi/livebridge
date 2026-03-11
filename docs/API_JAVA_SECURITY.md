# API Java — Endpoints de Segurança para Vídeo

Implementação dos endpoints que o LiveBridge espera para validar acesso a gravações e live.

---

## Configuração

Definir a mesma variável em Java e LiveBridge:

```
VIDEO_ACCESS_SECRET=<segredo_compartilhado>
```

Use um valor aleatório forte (ex.: `openssl rand -hex 32`).

---

## 1. `POST /api/lessons/check-video-access`

**Request:**
```
Content-Type: application/json
Cookie: <sessão do usuário>
Body: { "path": "live/matematica", "session": "2026-03-10_16-33-50" }
```

**Fluxo:**
1. Validar cookie de sessão (usuário logado).
2. Se inválido → `403`.
3. Gerar JWT com payload: `{ path, session, exp: now+3600, iat: now }`.
4. Assinar com `VIDEO_ACCESS_SECRET` (HS256).
5. Retornar `200` + `{ "token": "<jwt>" }`.

**Exemplo (Java com jjwt):**
```java
// Validar sessão do usuário (cookie)
// ...

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

## 2. `POST /api/lessons/check-live-access`

**Request:**
```
Content-Type: application/json
Cookie: <sessão do usuário>
Body: { "streamName": "matematica" }
```

**Fluxo:**
1. Validar cookie de sessão.
2. Se inválido → `403`.
3. Gerar JWT com payload: `{ streamName, exp: now+14400, iat: now }` (4h).
4. Assinar com `VIDEO_ACCESS_SECRET` (HS256).
5. Retornar `200` + `{ "token": "<jwt>" }`.

**Exemplo:**
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

## 3. Validação de sessão

O cookie de sessão é enviado automaticamente pelo navegador quando o frontend usa `credentials: 'include'`. A validação depende do seu sistema de autenticação (Spring Security, etc.).

**Importante:** Sem validação por curso no momento — qualquer usuário autenticado pode acessar qualquer vídeo/live. Para adicionar restrição por curso, incluir a lógica no passo 1 de cada endpoint.
