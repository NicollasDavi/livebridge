# LiveBridge — Gestão de Projeto

Documento para acompanhamento do projeto: o que é, o que foi feito, como foi feito e o que está em desenvolvimento.

---

## 1. O que é a aplicação

**LiveBridge** é um servidor de streaming ao vivo (live) e gravações de aulas, integrado à plataforma Posiplay. Permite:

- **Transmissão ao vivo:** professor transmite via OBS → alunos assistem em tempo real (HLS)
- **Gravações:** vídeos gravados durante a live são concatenados, enviados ao R2 (Cloudflare) e disponibilizados para assistir depois
- **Integração:** frontend (posiplay_frontend) e backend Java (posiplay_api) consomem o LiveBridge para exibir aulas ao vivo e gravadas

**Stack:** Docker, MediaMTX (RTMP/HLS), Node.js (API), Nginx, FFmpeg, R2 Cloudflare.

---

## 2. Entregas realizadas

### Entrega 1 — Streaming e gravação básica

| Item | Descrição |
|------|-----------|
| **O que foi feito** | RTMP ingest (OBS), HLS para assistir ao vivo, gravação em disco, concatenação com FFmpeg, upload para R2 |
| **Como** | MediaMTX recebe RTMP na 1935, grava segmentos; serviço Merge concatena e envia ao R2; API lista e faz stream dos vídeos |
| **Arquivos principais** | `server/docker-compose.yml`, `server/mediamtx/`, `server/merge/`, `server/api/` |

---

### Entrega 2 — Player web e metadata

| Item | Descrição |
|------|-----------|
| **O que foi feito** | Interface web (player embutido), listagem de gravações, edição de metadata (nome, professor, matéria, etc.), integração com API Lessons (Java) |
| **Como** | Nginx serve `server/player/`; API busca metadata em `GET /api/lessons`; `PUT /api/recordings/metadata` atualiza no Java |
| **Arquivos principais** | `server/player/index.html`, `server/api/server.js` |

---

### Entrega 3 — Seek em gravações (MP4)

| Item | Descrição |
|------|-----------|
| **O que foi feito** | Barra de seek funcional em gravações; respostas 206 (Range) em vez de 200 |
| **Como** | `proxy_pass_request_headers on` no nginx para encaminhar o header `Range` ao proxy de vídeo |
| **Arquivos principais** | `server/player/nginx.conf` |

---

### Entrega 4 — Segurança (JWT)

| Item | Descrição |
|------|-----------|
| **O que foi feito** | Proteção de gravações e live com token JWT; fluxo com Java (check-video-access, check-live-access); cookie `vid_live` para HLS |
| **Como** | Java gera JWT com `VIDEO_ACCESS_SECRET`; frontend obtém token e usa em URL ou init-live; LiveBridge valida token/cookie |
| **Arquivos principais** | `server/api/server.js`, `docs/API_JAVA_SECURITY.md`, `docs/API_LIVE.md` |

---

### Entrega 5 — SSL/HTTPS

| Item | Descrição |
|------|-----------|
| **O que foi feito** | Certificado autoassinado; HTTP (80) redireciona para HTTPS (443); porta 8081 em HTTP para dev |
| **Como** | Nginx com `ssl_certificate`; script `generate-self-signed-cert.sh`; porta 8080 no container para HTTP sem redirect |
| **Arquivos principais** | `server/player/nginx.conf`, `server/scripts/`, `server/certs/` |

---

### Entrega 6 — Integração com posiplay (proxy Java)

| Item | Descrição |
|------|-----------|
| **O que foi feito** | Java faz proxy de HLS e gravações; init-live no Java; cookie `vid_live` com Path=/hls; LiveBridge valida cookie via auth_request |
| **Como** | Frontend chama Java; Java valida sessão, gera token, define cookie e faz proxy para LiveBridge |
| **Arquivos principais** | `docs/API_LIVE.md`, Java: `LiveController`, `VideoStreamService` |

---

### Entrega 7 — Correção auth_request (nginx)

| Item | Descrição |
|------|-----------|
| **O que foi feito** | Correção do 404/500 no auth_request; location interno `/internal/check-video-access` repassa Cookie para a API |
| **Como** | Nginx não repassa Cookie no auth_request por padrão; location `internal` com `proxy_set_header Cookie $http_cookie` |
| **Arquivos principais** | `server/player/nginx.conf` |

---

## 3. Como foi feito (resumo técnico)

| Camada | Tecnologia | Função |
|--------|------------|--------|
| **Ingest** | MediaMTX, RTMP 1935 | Recebe stream do OBS |
| **Streaming** | MediaMTX, HLS 8888 | Serve HLS para player |
| **Gravação** | MediaMTX → disco | Segmentos .ts |
| **Merge** | FFmpeg, Node.js | Concatena e envia ao R2 |
| **Storage** | R2 Cloudflare | Vídeos MP4 |
| **API** | Node.js, Express | Listagem, stream, auth, metadata |
| **Proxy** | Nginx | API, HLS, SSL, auth_request |
| **Player** | HTML/JS, Hls.js | Interface embutida |

---

## 4. O que está em desenvolvimento no momento

| Item | Status | Observação |
|------|--------|------------|
| **Live via proxy Java** | Em validação | Fluxo check-live-access → init-live → proxy HLS; depende de `livebridge.url` correto no Java (HTTP em dev) |
| **Stream ativo no MediaMTX** | Em validação | OBS deve publicar em `rtmp://localhost:1935/live/{nome}` para o HLS funcionar |
| **Documentação de rotas** | Concluída | `docs/API_LIVE.md`, `docs/API_ROUTES.md` |

---

## 5. Próximos passos sugeridos

1. Validar live completo: OBS → MediaMTX → Java proxy → frontend
2. Ajustar `livebridge.url` no Java para ambiente de produção (HTTPS, URL correta)
3. Revisar modo legado (sem `VIDEO_ACCESS_SECRET`) se necessário para cenários sem Java

---

## 6. Referências rápidas

| Documento | Conteúdo |
|-----------|----------|
| `README.md` | Início rápido, portas, OBS |
| `DOCUMENTACAO_TECNICA.md` | Detalhes técnicos por componente |
| `MANUTENCAO.md` | Operação e troubleshooting |
| `docs/API_FRONTEND.md` | Integração frontend (gravações + live) |
| `docs/API_LIVE.md` | Live: rotas, proxy Java, troubleshooting |
| `docs/API_JAVA_SECURITY.md` | Endpoints Java (check-video-access, check-live-access) |
