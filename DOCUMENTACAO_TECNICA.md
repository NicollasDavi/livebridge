# Documentação Técnica — LiveBridge

Documentação extensa da aplicação, explicando cada arquivo, configuração e trecho de código, com o propósito de cada decisão técnica.

---

## Índice

1. [Arquitetura geral](#1-arquitetura-geral)
2. [Docker Compose](#2-docker-compose)
3. [MediaMTX (RTMP/HLS)](#3-mediamtx-rtmphls)
4. [Merge (concatenação e upload R2)](#4-merge-concatenação-e-upload-r2)
5. [API (Node.js)](#5-api-nodejs)
6. [Nginx](#6-nginx)
7. [Player (frontend)](#7-player-frontend)
8. [Variáveis de ambiente](#8-variáveis-de-ambiente)

---

## 1. Arquitetura geral

```
┌─────────────┐     RTMP :1935      ┌──────────────┐     HLS :8888      ┌─────────────┐
│     OBS     │ ──────────────────► │   MediaMTX   │ ◄────────────────── │   Nginx    │
│  (professor)│                     │  (streaming) │                     │  :8081     │
└─────────────┘                     └──────┬───────┘                     └─────┬───────┘
                                           │                                  │
                                           │ grava .ts                        │ /hls/
                                           ▼                                  │
                                    ┌──────────────┐                          │
                                    │  /recordings │                          │
                                    │  (disco)     │                          │
                                    └──────┬───────┘                          │
                                           │                                  │
                                           │ merge (ffmpeg)                   │
                                           ▼                                  │
                                    ┌──────────────┐     GET /api/            │
                                    │    Merge     │ ◄────────────────────────┤
                                    │   :8080      │                          │
                                    └──────┬───────┘                          │
                                           │ upload                           │
                                           ▼                                  │
                                    ┌──────────────┐     GET /api/recordings  │
                                    │  R2 Cloudflare│ ◄──────────────────────┤
                                    └──────────────┘                          │
                                                                              │
                                    ┌──────────────┐     proxy                │
                                    │     API      │ ◄────────────────────────┘
                                    │   :3000      │
                                    └──────────────┘
```

**Fluxo resumido:**
- OBS envia RTMP para MediaMTX na porta 1935
- MediaMTX grava segmentos `.ts` em disco e serve HLS na porta 8888
- Nginx faz proxy de `/hls/` para MediaMTX e de `/api/` para a API
- Merge detecta sessões finalizadas, concatena com ffmpeg e envia ao R2
- API lista gravações do R2 e faz stream dos vídeos via proxy

---

## 2. Docker Compose

**Arquivo:** `server/docker-compose.yml`

### 2.1 Serviço `mediamtx`

```yaml
mediamtx:
  image: bluenviron/mediamtx:latest
  container_name: livebridge-mediamtx
  restart: unless-stopped
  volumes:
    - ./mediamtx/mediamtx.yml:/mediamtx.yml:ro
    - ./recordings:/recordings
    - mediamtx-hls:/hls
  ports:
    - "1935:1935"   # RTMP (OBS)
    - "8888:8888"   # HLS
```

| Campo | Explicação |
|-------|------------|
| `image: bluenviron/mediamtx:latest` | Imagem oficial do MediaMTX. `latest` garante atualizações ao fazer `docker compose pull`. |
| `restart: unless-stopped` | Container reinicia automaticamente após crash ou reboot do servidor. |
| `./mediamtx/mediamtx.yml:/mediamtx.yml:ro` | Monta o arquivo de configuração. `:ro` = read-only, evita alterações acidentais no container. |
| `./recordings:/recordings` | Pasta onde o MediaMTX grava os `.ts`. Compartilhada com o Merge para leitura. |
| `mediamtx-hls:/hls` | Volume nomeado para os segmentos HLS em disco. Evita usar RAM para 8h de DVR. |
| `1935` | Porta padrão do RTMP. O OBS usa essa porta por padrão. |
| `8888` | Porta interna do HLS. O acesso externo é via Nginx na 8081. |

### 2.2 Serviço `merge`

```yaml
merge:
  build: ./merge
  ...
  environment:
    RECORDINGS_DIR: /recordings
    COMPRESS_VIDEO: ${COMPRESS_VIDEO:-1}
    COMPRESS_CODEC: ${COMPRESS_CODEC:-h265}
    COMPRESS_PRESET: ${COMPRESS_PRESET:-veryslow}
    COMPRESS_CRF: ${COMPRESS_CRF:-28}
    COMPRESS_CRF_H264: ${COMPRESS_CRF_H264:-23}
    COMPRESS_CRF_H265: ${COMPRESS_CRF_H265:-28}
    COMPRESS_AUDIO_BITRATE: ${COMPRESS_AUDIO_BITRATE:-64k}
    ...
  volumes:
    - ./recordings:/recordings
  ports:
    - "8082:8080"
```

| Campo | Explicação |
|-------|------------|
| `build: ./merge` | Constrói a imagem a partir do Dockerfile em `server/merge/`. |
| `RECORDINGS_DIR: /recordings` | Mesmo caminho que o MediaMTX usa. O Merge lê os `.ts` daqui. |
| `${COMPRESS_VIDEO:-1}` | Usa variável do `.env`; se não existir, usa `1` (compressão ativada). |
| `COMPRESS_CODEC` / `PRESET` / `CRF` / `AUDIO` | Padrão: HEVC (`h265`), `veryslow`, CRF 28, AAC 64k — prioridade em menor arquivo (encode lento). |
| `8082:8080` | Porta 8080 interna, 8082 externa. Evita conflito com outros serviços. |

### 2.3 Serviço `api`

```yaml
api:
  build: ./api
  ...
  environment:
    R2_ACCOUNT_ID: ${R2_ACCOUNT_ID:-}
    ...
  ports:
    - "3000:3000"
```

A API não expõe a porta 3000 diretamente ao mundo; o Nginx faz proxy. A porta 3000 é usada apenas entre containers.

### 2.4 Serviço `nginx`

```yaml
nginx:
  image: nginx:alpine
  depends_on:
    - api
    - mediamtx
  volumes:
    - ./player:/usr/share/nginx/html:ro
    - ./player/nginx.conf:/etc/nginx/conf.d/default.conf:ro
  ports:
    - "8081:80"
```

| Campo | Explicação |
|-------|------------|
| `depends_on` | Garante que API e MediaMTX subam antes do Nginx. |
| `./player:/usr/share/nginx/html` | Serve os arquivos estáticos (HTML, JS, CSS) do player. |
| `8081:80` | Porta única de entrada para o usuário. Toda a aplicação é acessada por `http://IP:8081`. |

### 2.5 Volume `mediamtx-hls`

```yaml
volumes:
  mediamtx-hls:
```

Volume nomeado para armazenar os segmentos HLS em disco. Com `hlsSegmentCount: 28800` (8h), manter tudo em RAM consumiria vários GB. O `hlsDirectory: /hls` no MediaMTX redireciona os segmentos para esse volume.

---

## 3. MediaMTX (RTMP/HLS)

**Arquivo:** `server/mediamtx/mediamtx.yml`

### 3.1 Nível de log

```yaml
logLevel: warn
```

**Por quê:** `warn` reduz ruído no log. `debug` ou `info` gerariam muitas linhas durante transmissões longas.

### 3.2 Protocolos desabilitados

```yaml
rtsp: false
srt: false
webrtc: false
```

**Por quê:** O LiveBridge usa apenas RTMP (entrada) e HLS (saída). RTSP, SRT e WebRTC aumentam superfície de ataque e consumo de recursos sem benefício.

### 3.3 RTMP

```yaml
rtmp: true
rtmpAddress: :1935
```

| Parâmetro | Explicação |
|-----------|------------|
| `rtmp: true` | Habilita o servidor RTMP. |
| `rtmpAddress: :1935` | Escuta em todas as interfaces (`:`) na porta 1935. O OBS conecta em `rtmp://IP:1935/live/NOME`. |

### 3.4 HLS

```yaml
hls: true
hlsAddress: :8888
hlsAllowOrigins: ['*']
hlsVariant: mpegts
hlsAlwaysRemux: true
hlsSegmentCount: 28800
hlsSegmentDuration: 1s
hlsSegmentMaxSize: 50M
hlsDirectory: /hls
```

| Parâmetro | Valor | Explicação |
|----------|-------|------------|
| `hlsAllowOrigins: ['*']` | `*` | Permite CORS de qualquer origem. O player pode estar em outro domínio. |
| `hlsVariant: mpegts` | mpegts | Segmentos em MPEG-TS. Mais compatível que fMP4 em players antigos. |
| `hlsAlwaysRemux: true` | true | Garante remux mesmo quando o source já é compatível. Evita problemas de sincronização. |
| `hlsSegmentCount: 28800` | 28800 | 28800 × 1s = 8h de DVR. Permite voltar ao início da live (estilo YouTube). |
| `hlsSegmentDuration: 1s` | 1s | Segmentos de 1 segundo. Menor = menor latência, mais requisições HTTP. |
| `hlsSegmentMaxSize: 50M` | 50M | Limite por segmento para evitar estouro de RAM em picos de bitrate. |
| `hlsDirectory: /hls` | /hls | Salva segmentos em disco em vez de RAM. Necessário para 8h de buffer. |

### 3.5 Paths e gravação

```yaml
paths:
  "~^live/.+":
    source: publisher
    record: yes
    recordPath: /recordings/%path/%Y-%m-%d_%H-%M-%S-%f
    recordFormat: mpegts
    recordSegmentDuration: 60s
    recordDeleteAfter: 0s
```

| Parâmetro | Explicação |
|-----------|------------|
| `"~^live/.+"` | Regex: paths que começam com `live/` (ex: `live/matematica`, `live/aula1`). |
| `source: publisher` | O stream vem de quem publica (OBS), não de um arquivo ou URL. |
| `record: yes` | Ativa gravação em disco. |
| `recordPath` | Template: `%path` = path do stream, `%Y-%m-%d_%H-%M-%S` = timestamp, `%f` = extensão. Ex: `/recordings/live/matematica/2026-03-10_14-30-00-0.ts` |
| `recordFormat: mpegts` | Grava em MPEG-TS (`.ts`), formato que o ffmpeg concatena bem. |
| `recordSegmentDuration: 60s` | Um arquivo `.ts` a cada 60 segundos. Reduz quantidade de arquivos. |
| `recordDeleteAfter: 0s` | Não apaga automaticamente. O Merge remove após upload para o R2. |

---

## 4. Merge (concatenação e upload R2)

**Arquivo:** `server/merge/server.js`

### 4.1 Variáveis de ambiente

```javascript
const RECORDINGS_DIR = (process.env.RECORDINGS_DIR || '/recordings').trim();
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID?.trim();
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY?.trim();
const R2_SECRET_KEY = process.env.R2_SECRET_KEY?.trim();
const R2_BUCKET = (process.env.R2_BUCKET || 'livebridge').trim();
const R2_VIDEOS_PREFIX = 'recordings/videos/';
const COMPRESS_VIDEO = process.env.COMPRESS_VIDEO !== '0';
const COMPRESS_CODEC = (process.env.COMPRESS_CODEC || 'h265').toLowerCase();
const COMPRESS_PRESET = process.env.COMPRESS_PRESET || 'veryslow';
const COMPRESS_CRF_H264 = parseInt(process.env.COMPRESS_CRF_H264 || process.env.COMPRESS_CRF || '23', 10) || 23;
const COMPRESS_CRF_H265 = parseInt(process.env.COMPRESS_CRF_H265 || process.env.COMPRESS_CRF || '28', 10) || 28;
const COMPRESS_AUDIO_BITRATE = (process.env.COMPRESS_AUDIO_BITRATE || '64k').trim();
const FFMPEG_TIMEOUT_MS = parseInt(process.env.FFMPEG_TIMEOUT_MS || '43200000', 10) || 43200000;
```

| Variável | Padrão | Explicação |
|----------|--------|------------|
| `RECORDINGS_DIR` | `/recordings` | Raiz das gravações. Deve coincidir com o volume montado. |
| `R2_VIDEOS_PREFIX` | `recordings/videos/` | Prefixo das chaves no R2. Ex: `recordings/videos/live/matematica/2026-03-10_14-30-00.mp4` |
| `COMPRESS_VIDEO !== '0'` | true | Qualquer valor exceto `0` ativa compressão. |
| `COMPRESS_CODEC` | `h265` | `h265`/`hevc` = libx265 (menor arquivo). `h264` = libx264 + `-tune animation` (compatibilidade). |
| `COMPRESS_PRESET` | `veryslow` | Preset x264/x265: mais lento costuma comprimir mais. Para acelerar: `fast` ou `veryfast`. |
| `COMPRESS_CRF` / `_H264` / `_H265` | 28 (via CRF) | CRF por codec; os específicos sobrescrevem o genérico para aquele codec. HEVC ~26–30; H.264 ~20–24. |
| `COMPRESS_AUDIO_BITRATE` | `64k` | Bitrate AAC (ex: `64k`, `96k`). |
| `FFMPEG_TIMEOUT_MS` | 43200000 (12h) | Timeout para vídeos longos (ex: 8h). |

### 4.2 Cliente S3/R2

```javascript
const s3 = hasR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
}) : null;
```

**Por quê:** O R2 é compatível com a API S3. `region: 'auto'` é exigido pelo R2. O endpoint usa o Account ID da Cloudflare.

### 4.3 Função `mergeAndUpload` — localização da sessão

```javascript
if (sessionNameOrDir) {
  if (typeof sessionNameOrDir === 'string' && sessionNameOrDir.includes('/')) {
    sessionDir = sessionNameOrDir;
    sessionName = sessionDir.split('/').pop();
  } else {
    sessionDir = join(RECORDINGS_DIR, path, sessionNameOrDir);
    sessionName = sessionNameOrDir;
  }
  ...
} else {
  const fullPath = join(RECORDINGS_DIR, path);
  const tsInStream = readdirSync(fullPath).filter(f => f.endsWith('.ts'));
  if (tsInStream.length > 0) {
    // "flat": .ts diretamente na pasta do stream (formato antigo do MediaMTX)
    sessionDir = fullPath;
    deleteFolderAfter = false;
    ...
  } else {
    // .ts em subpastas por sessão (formato atual: timestamp)
    const dirs = entries.filter(e => e.isDirectory()).map(...).sort((a, b) => b.mtime - a.mtime);
    sessionDir = dirs[0].path;
    sessionName = dirs[0].name;
  }
}
```

**Por quê:** O MediaMTX pode gravar de duas formas: (1) `.ts` direto em `live/NOME/` (flat) ou (2) em subpastas `live/NOME/YYYY-MM-DD_HH-MM-SS/`. O código trata ambos.

### 4.4 Ordenação dos `.ts`

```javascript
const tsFiles = readdirSync(sessionDir)
  .filter(f => f.endsWith('.ts'))
  .sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb || a.localeCompare(b, undefined, { numeric: true });
  });
```

**Por quê:** Os nomes podem ser `0.ts`, `1.ts` ou `2026-03-10_14-30-00-0.ts`. Extrair números garante ordem cronológica. O `localeCompare` com `numeric: true` trata casos como `2.ts` vs `10.ts`.

### 4.5 Arquivo de concatenação do ffmpeg

```javascript
const listPath = join(sessionDir, '_concat.txt');
const listContent = tsFiles.map(f => `file '${join(sessionDir, f)}'`).join('\n');
writeFileSync(listPath, listContent);
```

**Por quê:** O ffmpeg usa `-f concat -safe 0 -i arquivo.txt` para juntar vários arquivos. O formato é `file 'caminho'` por linha. `_concat.txt` é temporário e removido depois.

### 4.6 Comando ffmpeg

A função `buildCompressFfmpegArgs(listPath, outPath)` monta um array de argumentos passado a `spawn('ffmpeg', ffmpegArgs, …)`.

**Com compressão (HEVC, padrão):** `-c:v libx265`, `-crf` (H265), `-preset`, `-tag:v hvc1` (MP4), `-c:a aac -b:a` (bitrate configurável), `-movflags +faststart`, `-progress pipe:1 -nostats` (progresso).

**Com compressão (H.264):** `COMPRESS_CODEC=h264` → `-c:v libx264`, `-tune animation`, CRF H264, mesmo áudio e `+faststart`.

```javascript
function buildCompressFfmpegArgs(listPath, outPath) {
  const tail = ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outPath];
  const base = ['-y', '-threads', '0', '-f', 'concat', '-safe', '0', '-i', listPath];
  const audio = ['-c:a', 'aac', '-b:a', COMPRESS_AUDIO_BITRATE, '-aac_coder', 'twoloop'];
  if (COMPRESS_CODEC === 'h265' || COMPRESS_CODEC === 'hevc') {
    return [...base, '-c:v', 'libx265', '-crf', String(COMPRESS_CRF_H265), '-preset', COMPRESS_PRESET, '-tag:v', 'hvc1', ...audio, ...tail];
  }
  return [...base, '-c:v', 'libx264', '-crf', String(COMPRESS_CRF_H264), '-preset', COMPRESS_PRESET, '-tune', 'animation', ...audio, ...tail];
}

const ffmpegArgs = COMPRESS_VIDEO
  ? buildCompressFfmpegArgs(listPath, outPath)
  : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-progress', 'pipe:1', '-nostats', outPath];
```

| Parâmetro | Explicação |
|-----------|------------|
| `-y` | Sobrescreve o arquivo de saída sem perguntar. |
| `-threads 0` | Usa todos os núcleos da CPU (modo compressão). |
| `-f concat -safe 0` | Modo concat. `-safe 0` permite caminhos absolutos. |
| `-c:v libx265` / `libx264` | Vídeo: HEVC (padrão) ou H.264. |
| `-tag:v hvc1` | Tag para HEVC em MP4 (melhor compatibilidade em players). |
| `-crf N` | Constante Rate Factor por codec escolhido. |
| `-preset` | Velocidade vs compressão no encoder escolhido. |
| `-tune animation` | Só no H.264: conteúdo com movimento (aulas, telas). |
| `-c:a aac -b:a …` | AAC com bitrate de `COMPRESS_AUDIO_BITRATE`. |
| `-movflags +faststart` | Metadados no início do MP4 para iniciar reprodução cedo. |
| `-progress pipe:1 -nostats` | Saída de progresso para o serviço acompanhar o encode. |
| `-c copy` | Sem re-encoding quando `COMPRESS_VIDEO=0`. |

### 4.7 Upload multipart para R2

```javascript
const upload = new Upload({
  client: s3,
  params: {
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: createReadStream(outPath),
    ContentType: 'video/mp4'
  },
  queueSize: 4,
  partSize: 100 * 1024 * 1024, // 100MB
  leavePartsOnError: false
});
await upload.done();
```

**Por quê:** Vídeos grandes exigem upload multipart (partes de até 5GB no S3). `partSize: 100MB` equilibra memória e desempenho. `leavePartsOnError: false` limpa partes órfãs em caso de falha.

### 4.8 Limpeza após upload

```javascript
for (const f of tsFiles) {
  try { unlinkSync(join(sessionDir, f)); } catch (_) {}
}
try { unlinkSync(outPath); } catch (_) {}
if (deleteFolderAfter) {
  try { rmSync(sessionDir, { recursive: true }); } catch (_) {}
}
```

**Por quê:** Libera espaço em disco. Os `.ts` e o MP4 local não são mais necessários após o upload.

### 4.9 Detecção de sessões finalizadas

```javascript
const STALE_MS = 2 * 60 * 1000;  // 2 minutos
// ...
if (age >= STALE_MS) {
  // sessão "stale" = nenhum .ts novo há 2+ minutos
  mergeAndUpload(mtxPath, sess.name).then(...);
}
```

**Por quê:** 2 minutos sem novos `.ts` indica que o professor parou a transmissão. Evita processar sessões ainda em gravação.

### 4.10 Intervalo de scan

```javascript
setInterval(findStaleSessions, 30000);  // a cada 30 segundos
setTimeout(findStaleSessions, 5000);   // primeiro scan após 5s
```

**Por quê:** 30s é um bom compromisso entre responsividade e carga. O delay inicial de 5s dá tempo para o MediaMTX criar as pastas.

### 4.11 Endpoint `/merge/upload`

```javascript
app.post('/merge/upload', async (req, res) => {
  // Envia MP4 existente para R2 sem re-encodar
  const outPath = join(RECORDINGS_DIR, path, `${session}.mp4`);
  if (!existsSync(outPath)) return res.status(404).json({ error: '...' });
  // ... upload
});
```

**Por quê:** Se o ffmpeg terminou mas o upload falhou, o MP4 fica no disco. Este endpoint permite reenviar sem rodar o ffmpeg de novo.

---

## 5. API (Node.js)

**Arquivo:** `server/api/server.js`

### 5.1 Cookie de acesso a vídeo

```javascript
const VIDEO_ACCESS_COOKIE = 'vid_ctx';
const VIDEO_ACCESS_MAX_AGE = 86400;  // 24 horas

function setVideoAccessCookie(res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(VIDEO_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VIDEO_ACCESS_MAX_AGE
  });
}
```

**Por quê:** Evita que links diretos para HLS ou gravações funcionem sem passar pelo player. O cookie é definido ao acessar a plataforma e validado em `/api/check-video-access` e no endpoint de vídeo.

| Opção | Explicação |
|-------|------------|
| `httpOnly: true` | Cookie não acessível via JavaScript, reduz risco de XSS. |
| `sameSite: 'lax'` | Enviado em navegações same-site. Evita problemas com redirects. |
| `path: '/'` | Válido para todas as rotas. |
| `maxAge: 86400` | 24 horas em segundos. |

### 5.2 Middleware `requireVideoAccess`

```javascript
function requireVideoAccess(req, res, next) {
  const token = req.cookies?.[VIDEO_ACCESS_COOKIE];
  if (!token || token.length < 32) return res.status(403).json({ error: 'Acesso negado. Acesse a plataforma primeiro.' });
  next();
}
```

**Por quê:** O token tem 48 caracteres hex (24 bytes). `length < 32` rejeita tokens inválidos ou truncados.

### 5.3 Endpoint `/api/init`

```javascript
app.get('/api/init', (req, res) => {
  setVideoAccessCookie(res);
  res.json({ ok: true });
});
```

**Por quê:** O frontend chama ao carregar. Define o cookie e permite que requisições subsequentes (HLS, gravações) sejam autorizadas.

### 5.4 Endpoint `/api/check-video-access`

```javascript
app.get('/api/check-video-access', (req, res) => {
  const token = req.cookies?.[VIDEO_ACCESS_COOKIE];
  if (!token || token.length < 32) return res.status(403).end();
  res.status(200).end();
});
```

**Por quê:** Usado pelo `auth_request` do Nginx antes de repassar requisições para `/hls/`. Retorna 200 ou 403 sem corpo.

### 5.5 Listagem de gravações

```javascript
const result = await s3.send(new ListObjectsV2Command({
  Bucket: R2_BUCKET,
  Prefix: R2_VIDEOS_PREFIX,
  ContinuationToken: continuationToken,
  MaxKeys: 1000
}));
// ...
do {
  // paginação
  continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
} while (continuationToken);
```

**Por quê:** O S3/R2 retorna no máximo 1000 objetos por chamada. `ContinuationToken` permite paginar e listar todas as gravações.

### 5.6 Estrutura da chave no R2

```javascript
const rest = obj.Key.slice(R2_VIDEOS_PREFIX.length);  // ex: "live/matematica/2026-03-10_14-30-00.mp4"
const parts = rest.split('/');
const recPath = parts.join('/');   // "live/matematica"
const session = filename.replace('.mp4', '');  // "2026-03-10_14-30-00"
```

**Por quê:** O frontend precisa de `path` e `session` para montar a URL do vídeo: `/api/recordings/video?path=live/matematica&session=2026-03-10_14-30-00`.

### 5.7 Merge com API Lessons

```javascript
const [r2List, lessons] = await Promise.all([r2Promise, lessonsPromise]);
const lessonMap = new Map((Array.isArray(lessons) ? lessons : []).map(l => [l.id, l]));
for (const rec of r2List) {
  const lesson = lessonMap.get(rec.id);
  rec.name = lesson?.titulo ?? null;
  rec.numero = lesson?.aula ?? null;
  rec.assunto = lesson?.assunto ?? null;
  rec.professor = lesson?.professor ?? null;
  rec.materia = lesson?.materia ?? null;
  rec.frente = lesson?.frente ?? null;
  rec.cursos = Array.isArray(lesson?.cursos) ? lesson.cursos : [];
  rec.ativo = lesson?.ativo ?? true;
}
```

**Por quê:** A API Lessons (Java) guarda metadata (título, professor, matéria, frente, cursos, ativo, etc.). O `id` é `path|session`. O merge enriquece a lista do R2 com esses dados. O campo `ativo` indica se a aula está visível para os alunos (true) ou oculta (false).

### 5.8 Stream do vídeo (proxy)

```javascript
const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
res.set('Content-Type', 'video/mp4');
if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength));
const body = obj.Body;
if (body && typeof body.pipe === 'function') {
  body.pipe(res);
} else {
  res.send(Buffer.from(await body.transformToByteArray()));
}
```

**Por quê:** O vídeo é servido via API, não por URL direta do R2. Assim a URL do R2 não é exposta e o `requireVideoAccess` é aplicado.

---

## 6. Nginx

**Arquivo:** `server/player/nginx.conf`

### 6.1 Proxy para Merge

```nginx
location /merge-api/ {
    proxy_pass http://merge:8080/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Por quê:** O path `/merge-api/` é repassado ao Merge. O `/` no final de `proxy_pass` remove o prefixo. Ex: `/merge-api/merge?path=live/teste` → `http://merge:8080/merge?path=live/teste`.

### 6.2 Proxy para API

```nginx
location /api/ {
    proxy_pass http://api:3000/api/;
    ...
    proxy_connect_timeout 60s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

**Por quê:** Timeouts maiores para operações lentas (ex: listagem de muitos objetos no R2).

### 6.3 HLS com auth_request

```nginx
location /hls/ {
    auth_request /api/check-video-access;
    proxy_pass http://mediamtx:8888/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 86400s;
}
```

| Diretiva | Explicação |
|----------|------------|
| `auth_request /api/check-video-access` | Antes de repassar, o Nginx faz uma subrequisição para `/api/check-video-access`. Se retornar 403, o acesso ao HLS é negado. |
| `proxy_buffering off` | Streaming em tempo real; buffering atrapalharia a latência. |
| `proxy_read_timeout 86400s` | 24h. Transmissões longas não devem ser interrompidas por timeout. |

### 6.4 SPA (Single Page Application)

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

**Por quê:** Para rotas como `/recordings` ou `/live`, o Nginx tenta arquivo/diretório e, se não existir, serve `index.html`. O JavaScript do player cuida do roteamento.

---

## 7. Player (frontend)

**Arquivo:** `server/player/index.html`

### 7.1 Inicialização e cookie

```javascript
fetch('/api/init', { credentials: 'include' }).catch(() => {});
```

**Por quê:** `credentials: 'include'` envia e recebe cookies. Necessário para que o cookie `vid_ctx` seja definido e enviado nas requisições de vídeo.

### 7.2 Bloqueio do menu de contexto

```javascript
video.addEventListener('contextmenu', e => e.preventDefault());
```

**Por quê:** Reduz a chance de o usuário usar "Salvar vídeo como..." no player.

### 7.3 URL do HLS

```javascript
function getHLSUrl(name) {
  return baseUrl + '/hls/live/' + encodeURIComponent(name) + '/index.m3u8';
}
```

**Por quê:** O MediaMTX expõe o HLS em `http://host:8888/live/NOME/index.m3u8`. O Nginx faz proxy de `/hls/` para `mediamtx:8888/`, então a URL no player é `http://host:8081/hls/live/NOME/index.m3u8`. `encodeURIComponent(name)` evita problemas com caracteres especiais no nome do stream.

### 7.4 Barra de seek em live

```javascript
if (!isVodMode && (end - curr) < 10) {
  seek.value = 100;
} else {
  seek.value = ((curr - start) / range) * 100;
}
```

**Por quê:** Em live, o `seekable.end` avança a cada atualização da playlist HLS (ex.: a cada 5–8s). Se a barra fosse calculada normalmente, ela “voltaria” a cada atualização. Quando o usuário está a até 10s do live, fixamos a barra em 100% para evitar esse efeito.

### 7.5 Configuração do HLS.js para live

```javascript
hls = new Hls({
  liveSyncDurationCount: isVod ? 1 : 3,
  liveMaxLatencyDurationCount: isVod ? 2 : Infinity,
  liveDurationInfinity: !isVod,
  maxBufferLength: isVod ? 30 : 60,
  maxMaxBufferLength: isVod ? 60 : 300
});
```

| Parâmetro | Live | VOD | Explicação |
|----------|------|-----|------------|
| `liveSyncDurationCount` | 3 | 1 | Em live, fica 3 segmentos atrás do live. Em VOD, 1. |
| `liveMaxLatencyDurationCount` | Infinity | 2 | Em live, não força retorno ao live ao pausar/voltar. Em VOD, permite sync normal. |
| `liveDurationInfinity` | true | false | Em live, duração infinita (barra de progresso contínua). |
| `maxBufferLength` | 60 | 30 | Em live, buffer de 60s para permitir voltar no tempo. |
| `maxMaxBufferLength` | 300 | 60 | Até 5 min de buffer em live para DVR. |

**Por quê:** `liveMaxLatencyDurationCount: Infinity` evita que o HLS.js puxe o playhead de volta ao live quando o usuário pausa ou volta no tempo.

### 7.6 Elemento de vídeo

```html
<video id="video" playsinline controls controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback></video>
```

| Atributo | Explicação |
|----------|------------|
| `playsinline` | Em mobile, reproduz inline em vez de tela cheia. |
| `controlsList="nodownload noremoteplayback"` | Remove botão de download e opção de remote playback nos controles nativos. |
| `disablePictureInPicture` | Desativa PiP. |
| `disableRemotePlayback` | Desativa Chromecast e similares. |

---

## 8. Variáveis de ambiente

**Arquivo:** `server/.env`

### 8.1 R2 (Cloudflare)

| Variável | Obrigatório | Explicação |
|----------|-------------|------------|
| `R2_ACCOUNT_ID` | Sim | ID da conta Cloudflare (painel R2). |
| `R2_ACCESS_KEY` | Sim | Access Key do token de API R2. |
| `R2_SECRET_KEY` | Sim | Secret Key do token. |
| `R2_BUCKET` | Sim | Nome do bucket (ex: `livebridge`). |

### 8.2 Merge

| Variável | Padrão | Explicação |
|----------|--------|------------|
| `COMPRESS_VIDEO` | 1 | 1 = comprime, 0 = só copia (mais rápido, arquivo maior). |
| `COMPRESS_CODEC` | h265 | `h265`/`hevc` ou `h264`. |
| `COMPRESS_PRESET` | veryslow | Preset do encoder; mais lento tende a menor arquivo. |
| `COMPRESS_CRF` | 28 | Fallback quando `COMPRESS_CRF_H264`/`H265` não estão definidos. |
| `COMPRESS_CRF_H264` | 23 | CRF específico para H.264. |
| `COMPRESS_CRF_H265` | 28 | CRF específico para HEVC. |
| `COMPRESS_AUDIO_BITRATE` | 64k | Bitrate do AAC. |
| `FFMPEG_TIMEOUT_MS` | 43200000 | 12h em ms. Aumentar para vídeos muito longos. |

### 8.3 API

| Variável | Explicação |
|----------|------------|
| `LESSONS_API_URL` | URL da API de aulas (metadata). |
| `LESSONS_API_TOKEN` | Token de autenticação. |
| `SKIP_LESSONS_API` | 1 = não usa API de metadata. |

---

*Documentação técnica completa do LiveBridge — RTMP/HLS e R2 Cloudflare.*
