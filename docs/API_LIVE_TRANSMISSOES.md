# `GET /api/live/transmissoes`

> **Proxy Java:** [**`API_JAVA_ROTAS_E_AGENTE.md`**](API_JAVA_ROTAS_E_AGENTE.md) (§1, linha `transmissoes`).

Lista as transmissões ao vivo em curso (publisher ativo em `live/<nome>` no MediaMTX).

---

## Pedido

```
GET /api/live/transmissoes
```

Sem query nem corpo.

---

## Resposta `200`

```json
{
  "items": [
    {
      "path": "live/matematica",
      "streamName": "matematica",
      "online": true,
      "onlineTime": "2026-03-30T14:22:10Z",
      "sourceType": "rtmpConn",
      "hlsMasterUrl": "/api/live/hls-master.m3u8?streamName=matematica"
    }
  ]
}
```

| Campo | Descrição |
|-------|-----------|
| `path` | Path no MediaMTX (`live/<streamName>`). |
| `streamName` | Nome do stream (OBS: `.../live/<streamName>`). |
| `online` | Se o MediaMTX marcou o path como online. |
| `onlineTime` | ISO ou `null`. |
| `sourceType` | Tipo da fonte ou `null`. |
| `hlsMasterUrl` | Caminho relativo do master HLS ABR. |

Inclui só paths `live/<nome>` **sem** sufixo `_1080`, `_720`, `_480`, e que estejam no ar (`online` ou `ready` + `source`).

**Ver também:** [`API_JAVA_ROTAS_E_AGENTE.md`](API_JAVA_ROTAS_E_AGENTE.md) — rotas `hls-master`, HLS, JWT (`streamName`).

---

## Erros

| Status | Corpo |
|--------|--------|
| `502` | `{ "error": "Não foi possível consultar o MediaMTX", "detail": "..." }` |
| `504` | `{ "error": "MediaMTX não respondeu a tempo", "detail": "..." }` |

---

## Configuração (resumo)

- MediaMTX: `api: yes`, `apiAddress: :9997` em `mediamtx.yml`.
- MediaMTX: `authInternalUsers` tem de permitir `action: api` para o IP da API Node (rede Docker); o predefinido só autoriza `api` em `127.0.0.1`, o que gera **401** e esta rota responde **502**.
- API: `MEDIAMTX_CONTROL_API_URL` (padrão `http://mediamtx:9997`), `MEDIAMTX_HTTP_TIMEOUT_MS` (padrão `15000`).

---

## Integração (proxy na API Java)

Quem corre **fora** da rede Docker (ex. Spring no host) deve usar **`GET {livebridge.url}/api/live/transmissoes`** (mesmo host que gravações/HLS), **não** a Control API do MediaMTX (`:9997` não está exposta no host). O Node é quem consulta o MediaMTX. Um proxy pode repassar o JSON `200` ou o corpo `502`/`504` do LiveBridge; em falha de rede antes de chegar ao LiveBridge, a camada proxy pode devolver outra mensagem por defeito.
