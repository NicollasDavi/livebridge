# API Java — Live em multiresolução (ABR)

Documento **apenas** sobre o que a **API Java** deve expor para o browser ter **live HLS em 1080p / 720p / 480p** (variantes `live/<stream>_1080|_720|_480` no LiveBridge).

**Não inclui:** VOD/MP4 (`/api/video/play` no produto), gravação parcial HLS (`hlsUrl` do LiveBridge), `live-ended`, `lesson-boundary`.

---

## Pré-requisitos

| Config Java | Uso |
|-------------|-----|
| `LIVEBRIDGE_URL` | Base HTTP do LiveBridge **vista pelo servidor Java** (evitar `localhost` errado em Docker). |
| `VIDEO_ACCESS_SECRET` | Igual ao LiveBridge; JWT **HS256**. |

---

## Como a API Java “acede” à live noutras resoluções

A Java **não** transcodifica nem escolhe bitrate por si. Ela só:

1. **Autoriza** o utilizador (`check-live-access` → JWT com `streamName` **base**, ex. `matematica`).
2. **Põe o cookie** (`init-live`) para o nginx do LiveBridge aceitar os pedidos HLS.
3. **Reencaminha HTTP** para o LiveBridge nos paths onde o MediaMTX já publica cada degrau.

No LiveBridge, cada resolução é um **path distinto** (ffmpeg `transcode-abr.sh`):

| Resolução | Path HLS no LB (exemplo `streamName=matematica`) |
|-----------|--------------------------------------------------|
| 1080p | `/hls/live/matematica_1080/index.m3u8` (+ `.ts`) |
| 720p | `/hls/live/matematica_720/index.m3u8` (+ `.ts`) |
| 480p | `/hls/live/matematica_480/index.m3u8` (+ `.ts`) |

**Modo qualidade fixa (browser → Java → LB):** o cliente pede à Java, por exemplo,  
`GET {JAVA}/hls/live/matematica_720/index.m3u8`.  
A Java faz `GET {LIVEBRIDGE_URL}/hls/live/matematica_720/index.m3u8` com o **mesmo** `Cookie` do browser. Trocar `_720` por `_1080` ou `_480` no path = **outra resolução**; o mesmo JWT/cookie continua válido.

**Modo ABR:** o cliente pede `GET {JAVA}/api/live/hls-master?streamName=matematica`. A Java faz proxy do master do LB; o M3U8 lista as três variantes (URLs relativas tipo `/hls/live/..._1080/...`). O player (hls.js, etc.) pede depois cada playlist/segmento **ainda via Java** (`/hls/live/...`), sempre com o cookie.

Em resumo: **outras resoluções = outros paths em `/hls/live/<base>_{1080|720|480}/...`**, todos cobertos pelo **mesmo** fluxo de auth e pelo **mesmo** proxy `GET /hls/live/**`.

**Arranque do ABR:** após o OBS publicar em `live/<stream>`, o `runOnReady` arranca o ffmpeg; os paths `live/<stream>_1080`, `_720` e `_480` e os muxers HLS podem demorar **vários segundos** (ex.: ~10 s) a ficar online. Pedidos ao `index.m3u8` das variantes **antes** disso podem receber **404** no LiveBridge — não é falha do proxy Java. Exemplo de sequência nos logs do MediaMTX: primeiro `live/teste` + HLS; depois conexões RTMP de `127.0.0.1` (ffmpeg); por fim `live/teste_480`, `_720`, `_1080` “stream is available” e muxers HLS.

### hls.js: `levelParsingError` / «Missing Target Duration» (HTTP 200)

O master M3U8 do LiveBridge (por defeito) lista URLs **`/hls/live/<stream>_1080|720|480/index.m3u8`**. O browser resolve isso na **origem da página** (ex.: `http://localhost:3000/hls/live/...`). Muitos setups **Next.js** **não** têm rota em `/hls/*` — devolvem **HTML** (por vezes com status 200), e o hls.js tenta interpretar como playlist → erro **Missing Target Duration**.

Se o proxy HLS do vosso stack estiver só sob **`/api/hls/...`** (como nos vossos logs), o master tem de listar **`/api/hls/live/...`**, não `/hls/...`.

**No LiveBridge (API Node):** definir no `.env` / `docker-compose`:

```bash
LIVE_HLS_PATH_PREFIX=/api/hls
```

(Reiniciar o contentor `api`.) Isto altera o corpo de `GET /api/live/hls-master.m3u8` para prefixar as variantes com `/api/hls`. A **Java** (ou o Next) continua a fazer proxy de `/api/hls/live/**` para `{LB}/hls/live/**` no servidor.

**Alternativa:** reescrever o corpo do M3U8 no proxy Java (`/hls/` → `/api/hls/`) em vez de usar a variável no LB.

---

## Rotas que a Java **deve** ter

### 1. `POST /api/lessons/check-live-access`

| | |
|--|--|
| **Body** | `{ "streamName": "<nome base>" }` — ex.: `matematica` (sem `_1080`, `_720`, `_480`). |
| **Resposta 200** | `{ "token": "<jwt>" }` |
| **JWT claims** | `streamName` = mesmo nome base; `exp` / `iat` (ex.: 4 h). |
| **LiveBridge** | Nenhuma chamada; só gerar JWT após validar sessão do utilizador. |

Um único JWT com `streamName` base autoriza **`/hls/live/<stream>_1080`**, **`_720`** e **`_480`** no LiveBridge.

---

### 2. `POST /api/init-live`

| | |
|--|--|
| **Body** | `{ "streamName": "<nome base>", "token": "<jwt do passo 1>" }` |
| **Resposta 200** | `{ "ok": true }` |
| **Lógica** | Validar JWT (assinatura, `exp`, `streamName` coerente). Definir cookie **`vid_live`** (httpOnly; `Path` compatível com os pedidos a `/hls/...` no mesmo host da Java). |
| **LiveBridge** | Opcional: `POST {LB}/api/init-live` com o mesmo body, **se** a vossa política de cookies exigir; em muitos setups basta o cookie na Java e o proxy HLS reenvia o cookie ao LB. |

---

### 3. `GET /hls/live/**` (proxy)

| | |
|--|--|
| **Pedido browser** | Ex.: `GET {JAVA}/hls/live/matematica_720/index.m3u8` e segmentos `.ts` referenciados na playlist. |
| **Upstream** | `GET {LIVEBRIDGE_URL}/hls/live/<mesmo path após /hls/>` |
| **Headers** | Reenviar **`Cookie`** do cliente (com `vid_live`). Reenviar **`Range`** se existir. |
| **Playlist** | Nome do ficheiro tem de ser **`index.m3u8`**, não `main_stream.m3u8`. |

---

### 4. `GET /api/live/hls-master` — **obrigatório para ABR no browser**

Na Java **tem de existir** um endpoint que faça **proxy** para o master M3U8 do LiveBridge:

| | |
|--|--|
| **Query** | `streamName=<nome base>` (obrigatório). |
| **Upstream** | `GET {LIVEBRIDGE_URL}/api/live/hls-master.m3u8?streamName=<igual>` |
| **Resposta** | `Content-Type: application/vnd.apple.mpegurl` (ou equivalente); corpo = M3U8 repassado. |
| **Cookies** | Se o master ou variantes exigirem o mesmo mecanismo de auth que o nginx do LB, reenviar **`Cookie`** do cliente. |

O LiveBridge devolve um master que aponta para `/hls/live/<stream>_1080|_720|_480/index.m3u8`. Com o player na **mesma origem** que a Java, esses paths devem resolver no **proxy** da secção 3 (mesmo host).

---

### 5. `GET /api/live/transmissoes` (recomendado)

| | |
|--|--|
| **Upstream** | `GET {LIVEBRIDGE_URL}/api/live/transmissoes` |
| **Resposta** | JSON repassado; inclui `hlsMasterUrl` **relativo ao LB** (ex. `/api/live/hls-master.m3u8?streamName=...`). |
| **Frontend** | Ao montar URL para o player, usar a **rota da Java** (secção 4), ex.: `{JAVA}/api/live/hls-master?streamName=matematica`, não a URL crua do LB. |

---

## Fluxo resumido no frontend

1. `POST /api/lessons/check-live-access` → `token`  
2. `POST /api/init-live` → cookie  
3. **Uma qualidade:** `GET {JAVA}/hls/live/{stream}_{1080|720|480}/index.m3u8`  
4. **ABR:** `GET {JAVA}/api/live/hls-master?streamName={stream}`  

Sempre `credentials: 'include'` nos `fetch` que dependem de sessão.

---

## Validação do JWT no proxy HLS — evitar 403 «Token não corresponde ao stream»

O JWT de live tem **`streamName` = nome base** (ex.: `teste`). O pedido HLS usa o path **`/hls/live/teste_480/index.m3u8`**, ou seja, o primeiro segmento após `live/` é **`teste_480`**, não `teste`.

O **LiveBridge** (ficheiro `server/api/lib/jwtLive.js`) aceita o acesso se:

1. `payload.streamName === requestStream` **ou**
2. `payload.streamName === nomeBase(requestStream)`, onde `nomeBase` remove o sufixo `_1080`, `_720` ou `_480` do fim da string.

Exemplos com JWT `streamName: "teste"`:

| `requestStream` (como o nginx/LB vê) | Válido? |
|--------------------------------------|--------|
| `teste` | Sim (igualdade) |
| `teste_1080` | Sim (`liveStreamBaseName` → `teste`) |
| `teste_720` | Sim |
| `teste_480` | Sim |
| `outro_480` | Não |

**Se a Java fizer `jwt.streamName.equals("teste_480")` vai falhar sempre** e verá logs como *«Token inválido ou não corresponde ao stream»* com **403** antes mesmo de chamar o LiveBridge.

**Implementação alinhada ao LiveBridge (pseudo-código):**

```text
streamDoPedido = primeiro segmento do path após "/hls/live/"
  ex.: path /hls/live/teste_480/index.m3u8 → "teste_480"

base = streamDoPedido.replaceFirst("_(1080|720|480)$", "")

válido =
  payload.streamName.equals(streamDoPedido)
  || payload.streamName.equals(base)
```

Depois disto, reencaminhar o **path completo** para o LB, por exemplo  
`{LIVEBRIDGE_URL}/hls/live/teste_480/index.m3u8`, **não** só `/index.m3u8` (se o log mostrar `subPath=/index.m3u8` só, confirme que o URL upstream inclui `live/teste_480/`).

---

## O que **não** faz parte deste escopo

| Tema | Onde fica |
|------|-----------|
| HLS de **gravação parcial** (`hlsUrl` no JSON do `lesson-boundary`) | **Sem** proxy dedicado na Java; o JSON do LiveBridge devolve path/URL para o cliente usar **contra o LiveBridge** (ou política vossa de domínio). |
| **VOD MP4** no browser | Tipicamente `GET /api/video/play?lessonId=&variant=&playToken=` (ou Bearer) na **Java**; por baixo a Java chama `GET {LB}/api/recordings/video?...` — **não** documentado aqui. |

---

## Checklist de implementação (IA / backend)

- [ ] `check-live-access` + JWT `streamName` base  
- [ ] `init-live` + validação JWT + cookie `vid_live`  
- [ ] Proxy `GET /hls/live/**` → `{LB}/hls/live/**` + Cookie + Range; validar JWT com regra **base vs `_1080/_720/_480`** (secção acima)  
- [ ] Proxy **`GET /api/live/hls-master`** → `{LB}/api/live/hls-master.m3u8`  
- [ ] (Opcional mas usual) Proxy `GET /api/live/transmissoes`  
- [ ] Garantir que playlists usam **`index.m3u8`**  
- [ ] `LIVEBRIDGE_URL` correta em ambiente containerizado  