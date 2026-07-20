# LiveBridge — Settings API (guia para o frontend)

Documento para o **front externo** (Posiplay / admin) implementar leitura e alteração das configurações operacionais do LiveBridge.

Não existe UI neste repositório. O LiveBridge é só API.

---

## 1. Visão geral

| Item | Valor |
|------|--------|
| Base URL (dev local) | `http://127.0.0.1:8081` |
| Base URL (produção típica) | `https://<host-livebridge>` ou via **BFF Java** (proxy) |
| Rotas | `GET /api/settings`, `PUT /api/settings` |
| Persistência | `recordings/livebridge-settings.json` (vale na hora) |
| Auth escrita | Header `X-Access-Token` |

**Fluxo recomendado no front**

1. `GET /api/settings` ao abrir a tela de configuração  
2. Preencher toggles / selects com a resposta  
3. Em cada alteração (ou num botão “Salvar”), `PUT` só com os campos alterados (patch parcial)  
4. Atualizar a UI com o JSON de resposta (fonte da verdade)

Se o browser **não** chama o LiveBridge direto, o BFF Java deve expor (ou fazer proxy de) estas duas rotas e injetar o token no servidor — **não** colocar o `SETTINGS_TOKEN` no bundle do cliente público.

---

## 2. Autenticação

### GET `/api/settings`

- **Público** (sem token).  
- Útil para o painel mostrar o estado atual.

### PUT `/api/settings`

Obrigatório um destes headers (ou query, menos recomendado):

| Forma | Exemplo |
|-------|---------|
| Header (preferido) | `X-Access-Token: <token>` |
| Bearer | `Authorization: Bearer <token>` |
| Query | `?token=<token>` |

O token no servidor é `SETTINGS_TOKEN` ou, se vazio, `API_ACCESS_TOKEN` (mesmo valor usado noutras integrações Java ↔ LiveBridge).

| HTTP | Quando |
|------|--------|
| `401` | Token ausente ou inválido |
| `503` | Servidor sem `SETTINGS_TOKEN` nem `API_ACCESS_TOKEN` configurados |

```json
{ "error": "Token inválido. Use o SETTINGS_TOKEN / API_ACCESS_TOKEN." }
```

---

## 3. GET `/api/settings`

### Request

```http
GET /api/settings
Accept: application/json
```

Sem body. Resposta com `Cache-Control: no-store`.

### Response `200`

```json
{
  "ok": true,
  "mergeEnabled": true,
  "compressPreset": "veryslow",
  "compressCodec": "h265",
  "mergeResolutions": "1080,720,480",
  "recordLive": true,
  "updatedAt": "2026-07-20T18:00:00.000Z",
  "source": "file",
  "writeProtected": true
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `ok` | boolean | Sempre `true` em sucesso |
| `mergeEnabled` | boolean | Pós-live: gera MP4 e envia ao R2 |
| `compressPreset` | string | Preset FFmpeg do merge |
| `compressCodec` | `"h264"` \| `"h265"` | Codec do MP4 final |
| `mergeResolutions` | string | `"1080,720,480"` ou `"single"` (ou subconjunto ordenado) |
| `recordLive` | boolean | MediaMTX grava segmentos `.ts` no ingest |
| `updatedAt` | string \| null | ISO 8601 da última gravação via API; `null` se ainda só env |
| `source` | `"file"` \| `"env"` | `file` = já existe settings no disco; `env` = defaults do servidor |
| `writeProtected` | boolean | `true` se o servidor tem token configurado (PUT possível com auth) |

---

## 4. PUT `/api/settings`

### Request

```http
PUT /api/settings
Content-Type: application/json
X-Access-Token: <SETTINGS_TOKEN ou API_ACCESS_TOKEN>
Accept: application/json
```

Body JSON: **objeto com um ou mais campos** (patch). Campos omitidos mantêm o valor atual.

```json
{
  "mergeEnabled": false
}
```

Exemplo completo:

```json
{
  "mergeEnabled": true,
  "compressPreset": "fast",
  "compressCodec": "h265",
  "mergeResolutions": "1080,720,480",
  "recordLive": true
}
```

### Response `200`

```json
{
  "ok": true,
  "mergeEnabled": true,
  "compressPreset": "fast",
  "compressCodec": "h265",
  "mergeResolutions": "1080,720,480",
  "recordLive": true,
  "updatedAt": "2026-07-20T18:05:00.000Z",
  "source": "file",
  "message": "Merge/VOD ligado · encode h265/fast · resoluções 1080,720,480 · gravação .ts ligada",
  "recordLiveApply": { "ok": true }
}
```

| Campo extra | Quando | Descrição |
|-------------|--------|-----------|
| `message` | sempre | Resumo legível do estado final |
| `recordLiveApply` | só se `recordLive` mudou | `{ "ok": true }` ou `{ "ok": false, "error": "..." }` |
| `warning` | se `recordLiveApply.ok === false` | Settings **já gravados**, mas MediaMTX falhou ao aplicar gravação |

**Importante:** se vier `warning`, mostre aviso no UI; o ficheiro de settings já foi atualizado.

### Erros

| HTTP | Body típico | Causa |
|------|-------------|--------|
| `400` | `{ "error": "..." }` | Body inválido, campo desconhecido, valor fora da lista |
| `401` | `{ "error": "..." }` | Token inválido |
| `503` | `{ "error": "..." }` | Token não configurado no servidor |
| `500` | `{ "error": "..." }` | Erro interno |

Exemplos de `400`:

- `Campo não suportado: foo`
- `mergeEnabled deve ser boolean`
- `compressPreset inválido. Use: ultrafast, superfast, ...`
- `compressCodec inválido. Use "h264" ou "h265".`
- `mergeResolutions inválido. Use "single" ou lista entre 1080,720,480 ...`
- `Nenhum campo para atualizar`
- `Body JSON objeto obrigatório`

---

## 5. Campos — contrato para UI

### `mergeEnabled` (boolean)

| Valor | Efeito |
|-------|--------|
| `true` | Ao fim da live (scan stale ou `live-ended`), o merge gera MP4 e sobe ao R2 |
| `false` | Modo só-live: merge não processa; `POST /api/recordings/lesson-boundary` → **503** |

Sugestão UI: switch “Gerar MP4 e enviar ao R2”.

### `compressPreset` (string)

Presets FFmpeg x264/x265 aceites:

`ultrafast` · `superfast` · `veryfast` · `faster` · `fast` · `medium` · `slow` · `slower` · `veryslow`

| Uso típico | Preset |
|------------|--------|
| POC / demo rápida | `fast` ou `veryfast` |
| Menor ficheiro (mais lento) | `veryslow` (default do servidor) |

Sugestão UI: select. Label amigável + valor técnico.

### `compressCodec` (string)

| Valor | Notas |
|-------|--------|
| `h265` | Menor ficheiro; aceite também `hevc` no PUT (normaliza para `h265`) |
| `h264` | Máxima compatibilidade com players antigos |

Sugestão UI: select “H.265 (HEVC)” / “H.264”.

### `mergeResolutions` (string)

| Valor | Efeito |
|-------|--------|
| `"1080,720,480"` | Três MP4 no R2 (`…_1080.mp4`, etc.) |
| `"720,480"` | Só essas alturas (ordem no GET fica maior→menor) |
| `"single"` | Um ficheiro `session.mp4` (legado) |

Alturas permitidas: **1080**, **720**, **480** apenas.

Sugestão UI: multi-select de qualidades **ou** radio “Multi (1080/720/480)” vs “Único (single)”. Ao enviar multi, juntar com vírgula: `"1080,720,480"`.

### `recordLive` (boolean)

| Valor | Efeito |
|-------|--------|
| `true` | MediaMTX grava `.ts` do ingest (necessário para VOD/merge depois) |
| `false` | Não grava `.ts` — só HLS live; não haverá material para merge |

Sugestão UI: switch “Gravar sessão em disco”.  
Se `mergeEnabled === true` e `recordLive === false`, avisar: “Sem gravação local não haverá MP4 no R2.”

A mudança é aplicada no MediaMTX na hora (Control API). Lives já a gravar podem precisar de um novo publish OBS para o novo modo, conforme comportamento do MediaMTX.

---

## 6. Exemplos para o front

### TypeScript (tipos)

```ts
export type CompressPreset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow';

export type LivebridgeSettings = {
  mergeEnabled: boolean;
  compressPreset: CompressPreset;
  compressCodec: 'h264' | 'h265';
  mergeResolutions: string; // "single" | "1080,720,480" | ...
  recordLive: boolean;
  updatedAt: string | null;
  source: 'file' | 'env';
};

export type LivebridgeSettingsResponse = LivebridgeSettings & {
  ok: true;
  writeProtected?: boolean;
  message?: string;
  recordLiveApply?: { ok: boolean; error?: string };
  warning?: string;
};

export type LivebridgeSettingsPatch = Partial<{
  mergeEnabled: boolean;
  compressPreset: CompressPreset;
  compressCodec: 'h264' | 'h265' | 'hevc';
  mergeResolutions: string;
  recordLive: boolean;
}>;
```

### Fetch — ler

```ts
async function getLivebridgeSettings(baseUrl: string): Promise<LivebridgeSettingsResponse> {
  const r = await fetch(`${baseUrl}/api/settings`, { cache: 'no-store' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
```

### Fetch — gravar (via BFF que injeta o token)

```ts
async function patchLivebridgeSettings(
  baseUrl: string,
  token: string,
  patch: LivebridgeSettingsPatch
): Promise<LivebridgeSettingsResponse> {
  const r = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': token
    },
    body: JSON.stringify(patch)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  if (data.warning) console.warn(data.warning);
  return data;
}
```

### Presets para um `<select>`

```ts
export const COMPRESS_PRESET_OPTIONS = [
  { value: 'ultrafast', label: 'Ultra rápido (pior compressão)' },
  { value: 'superfast', label: 'Super rápido' },
  { value: 'veryfast', label: 'Muito rápido' },
  { value: 'faster', label: 'Mais rápido' },
  { value: 'fast', label: 'Rápido (bom para POC)' },
  { value: 'medium', label: 'Médio' },
  { value: 'slow', label: 'Lento' },
  { value: 'slower', label: 'Mais lento' },
  { value: 'veryslow', label: 'Muito lento (menor ficheiro)' }
] as const;
```

---

## 7. Comportamento e efeitos colaterais

| Ação no front | O que acontece no LiveBridge |
|---------------|------------------------------|
| `mergeEnabled: false` | Scan/encode/upload param; `live-ended` responde skip; `lesson-boundary` → 503 |
| `mergeEnabled: true` | Próximas sessões stale / `live-ended` disparam merge |
| Mudar `compress*` / `mergeResolutions` | Próximo job de merge já usa os novos valores (jobs a correr mantêm o que já iniciaram) |
| `recordLive` muda | PATCH no MediaMTX; pode falhar → ver `warning` |
| Reinício dos containers | Estado vem do ficheiro JSON; env só preenche defaults em falta |

---

## 8. CORS e proxy

- Se o front chama o LiveBridge **direto**, a origem do front tem de estar em `CORS_ORIGINS` no `.env` do LiveBridge. O header `X-Access-Token` já está permitido no CORS.
- Em produção Posiplay, o padrão é o **browser → API Java → LiveBridge**. Nesse caso:
  - O front chama rotas do Java (ex. `PUT /api/livebridge/settings`).
  - O Java valida sessão de admin e faz proxy para o LiveBridge com o token de serviço.
  - O contrato JSON pode ser o **mesmo** deste documento para facilitar.

---

## 9. Checklist de implementação (front)

- [ ] Tela admin (só roles autorizados) com os 5 campos  
- [ ] `GET` ao montar o formulário  
- [ ] `PUT` parcial ao salvar (ou debounce por campo)  
- [ ] Tratar `401` / `503` / `400` com mensagem de `error`  
- [ ] Mostrar `warning` se `recordLiveApply` falhar  
- [ ] Desabilitar / avisar `lesson-boundary` e fluxos de VOD quando `mergeEnabled === false`  
- [ ] Avisar se `mergeEnabled && !recordLive`  
- [ ] Token **nunca** no cliente público — só BFF ou painel interno com secret de servidor  

---

## 10. Referências

| Doc | Conteúdo |
|-----|----------|
| [Frontend-Externo.md](./Frontend-Externo.md) | Gravações, pending, visão geral |
| [API_ROUTES.md](./API_ROUTES.md) | Catálogo de rotas |
| `server/.env.example` | Defaults de env (`MERGE_ENABLED`, `COMPRESS_*`, `RECORD_LIVE`, `SETTINGS_TOKEN`) |
