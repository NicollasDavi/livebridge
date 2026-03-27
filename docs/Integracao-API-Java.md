# LiveBridge — Integração com API Java

Guia para configurar o **LiveBridge** para chamar a API Java (Posiplay/PosiHub).

---

## 1. Autenticação (X-Access-Token)

Quando o LiveBridge chama a API Java **sem** JWT (Bearer/cookie), precisa enviar o header:

```
X-Access-Token: <API_ACCESS_TOKEN>
```

O valor deve ser **idêntico** ao configurado na API Java.

---

## 2. Configuração na API Java

Defina o token (uma das opções):

**Opção A – Variável de ambiente**
```bash
export API_ACCESS_TOKEN=seu-token-secreto-aqui
```

**Opção B – application.properties**
```properties
api.access.token=seu-token-secreto-aqui
```

**Gerar token seguro:**
```bash
openssl rand -base64 64
```

---

## 3. Configuração no LiveBridge

No arquivo `server/.env`:

```bash
# Mesmo valor usado na API Java
LESSONS_API_TOKEN=seu-token-secreto-aqui

# Ou use API_ACCESS_TOKEN (fallback)
# API_ACCESS_TOKEN=seu-token-secreto-aqui
```

| Variável | Descrição |
|----------|-----------|
| `LESSONS_API_TOKEN` | Token para chamadas à API Java (preferência) |
| `API_ACCESS_TOKEN` | Fallback se `LESSONS_API_TOKEN` estiver vazio |

Reinicie o container da API após alterar:

```bash
cd server
docker compose restart api
```

---

## 4. Endpoints que o LiveBridge chama

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/lessons` | GET | Listar aulas |
| `/api/lessons/distinct/professores` | GET | Professores distintos |
| `/api/lessons/distinct/materias` | GET | Matérias distintas |
| `/api/lessons/distinct/frentes` | GET | Frentes distintas |
| `/api/lessons/distinct/cursos` | GET | Cursos distintos |
| `/api/videos` | POST | Registrar vídeo (após live-ended) |

---

## 5. Erro "Invalid or missing API access token"

Esse erro ocorre quando:

1. O header `X-Access-Token` não foi enviado
2. O token enviado é diferente do configurado na API Java
3. `LESSONS_API_TOKEN` ou `API_ACCESS_TOKEN` não está definido no LiveBridge

**Solução:** conferir que API Java e LiveBridge usam o **mesmo** valor de token.

---

## 6. Resumo

| Onde | O que configurar |
|------|------------------|
| API Java | `API_ACCESS_TOKEN` (env) ou `api.access.token` (properties) |
| LiveBridge | `LESSONS_API_TOKEN` ou `API_ACCESS_TOKEN` no `server/.env` |
