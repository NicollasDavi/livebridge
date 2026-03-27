# LiveBridge — Como enviar X-Access-Token (passo a passo)

Guia para configurar o LiveBridge para chamar a API Java com sucesso.

---

## 1. O que está acontecendo

A API Java exige autenticação em `/api/lessons/**`. Duas formas:

| Forma | Header | Quem usa |
|-------|--------|----------|
| Login (JWT) | `Authorization: Bearer <jwt>` | Frontend (usuário logado) |
| API Key | `X-Access-Token: <token>` | LiveBridge (sem login) |

O LiveBridge usa a **API Key**. Se o header não for enviado ou estiver errado → **401 Unauthorized**.

---

## 2. Token em desenvolvimento

- Se `API_ACCESS_TOKEN` **estiver definido** na API Java → use esse valor no LiveBridge.
- Se **não** estiver definido → a API Java usa o fallback: `dev-token-local-only-nao-usar-em-prod`.

O LiveBridge **sempre** deve enviar o **mesmo valor** que a API Java está usando. Para conferir qual token a API está esperando, veja `api.access.token` no `application.properties` ou a variável `API_ACCESS_TOKEN` no ambiente onde a API roda.

---

## 3. URL da API Java

| Ambiente | URL base |
|----------|----------|
| Local | `http://localhost:8080` |
| Produção | `https://api.posihub.com.br` (ou a configurada) |

Exemplo completo: `http://localhost:8080/api/lessons/distinct/professores`

---

## 4. Como enviar o header (exemplos de código)

### Node.js (fetch)

```javascript
const JAVA_API_URL = process.env.JAVA_API_URL || 'http://localhost:8080';
const API_ACCESS_TOKEN = process.env.API_ACCESS_TOKEN || 'dev-token-local-only-nao-usar-em-prod';

const response = await fetch(`${JAVA_API_URL}/api/lessons/distinct/professores`, {
  method: 'GET',
  headers: {
    'X-Access-Token': API_ACCESS_TOKEN,
    'Content-Type': 'application/json',
  },
});
```

### Node.js (axios)

```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: process.env.JAVA_API_URL || 'http://localhost:8080',
  headers: {
    'X-Access-Token': process.env.API_ACCESS_TOKEN || 'dev-token-local-only-nao-usar-em-prod',
    'Content-Type': 'application/json',
  },
});

const { data } = await api.get('/api/lessons/distinct/professores');
```

### Python (requests)

```python
import os
import requests

JAVA_API_URL = os.getenv('JAVA_API_URL', 'http://localhost:8080')
API_ACCESS_TOKEN = os.getenv('API_ACCESS_TOKEN', 'dev-token-local-only-nao-usar-em-prod')

response = requests.get(
    f'{JAVA_API_URL}/api/lessons/distinct/professores',
    headers={
        'X-Access-Token': API_ACCESS_TOKEN,
        'Content-Type': 'application/json',
    },
)
```

### cURL (teste manual)

```bash
curl -X GET "http://localhost:8080/api/lessons/distinct/professores" \
  -H "X-Access-Token: dev-token-local-only-nao-usar-em-prod" \
  -H "Content-Type: application/json"
```

Se retornar JSON (não 401) → está correto.

---

## 5. Checklist de configuração no LiveBridge

- [ ] **Variável de ambiente**  
  Defina `API_ACCESS_TOKEN` no LiveBridge (ou use o valor fixo em dev).

- [ ] **Nome do header**  
  Exatamente: `X-Access-Token` (com X maiúsculo, hífens, sem espaços).

- [ ] **Valor do token**  
  O **mesmo** valor de `API_ACCESS_TOKEN` (ou `api.access.token`) da API Java. Em dev, se a variável estiver definida, use esse valor; caso contrário, use o fallback `dev-token-local-only-nao-usar-em-prod`.

- [ ] **URL correta**  
  A API Java deve estar rodando (ex.: `http://localhost:8080`).

- [ ] **Todas as requisições**  
  O header deve ser enviado em **toda** chamada à API Java (lessons, videos, etc.).

---

## 6. Erros comuns

### "Invalid or missing API access token"

| Causa | Solução |
|-------|---------|
| Header não enviado | Adicionar `X-Access-Token` em todas as requisições |
| Nome errado | Usar exatamente `X-Access-Token` (não `x-access-token`, `Access-Token`, etc.) |
| Token diferente | Conferir que o valor é idêntico ao da API Java |
| Token vazio | Definir `API_ACCESS_TOKEN` no LiveBridge ou usar o valor de dev |

### Header com typo

❌ `x-access-token` (minúsculo)  
❌ `X-AccessToken` (sem hífen)  
❌ `Authorization: Bearer ...` (isso é JWT, não API Key)  
✅ `X-Access-Token: dev-token-local-only-nao-usar-em-prod`

### Variável de ambiente não carregada

Se o LiveBridge usa `process.env.API_ACCESS_TOKEN` e está vazio:

1. Definir no `.env` do LiveBridge: `API_ACCESS_TOKEN=dev-token-local-only-nao-usar-em-prod`
2. Ou reiniciar o LiveBridge após definir a variável
3. Ou usar o valor fixo no código (apenas para dev)

---

## 7. Teste rápido

1. **API Java rodando** em `http://localhost:8080`
2. Executar no terminal:

```bash
curl -v "http://localhost:8080/api/lessons/distinct/professores" \
  -H "X-Access-Token: dev-token-local-only-nao-usar-em-prod"
```

3. Se retornar **200** e JSON → token OK  
4. Se retornar **401** → conferir token na API Java (`api.access.token` em `application.properties`)

---

## 8. Resumo

```
LiveBridge precisa enviar em TODAS as requisições à API Java:

  Header: X-Access-Token
  Valor: o MESMO que API_ACCESS_TOKEN (ou api.access.token) na API Java
        (em dev, se a variável estiver definida, use ela)
```
