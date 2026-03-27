# Manual de Manutenção — LiveBridge

**Para quem não é técnico:** este documento explica como dar manutenção no servidor de transmissão (RTMP/HLS) e no armazenamento de vídeos (R2 da Cloudflare). Tudo em linguagem simples, passo a passo.

---

## Índice

1. [O que é o LiveBridge?](#1-o-que-é-o-livebridge)
2. [Visão geral do fluxo](#2-visão-geral-do-fluxo)
3. [Acessando o servidor](#3-acessando-o-servidor)
4. [Manutenção do RTMP/HLS (transmissão ao vivo)](#4-manutenção-do-rtmphls-transmissão-ao-vivo)
5. [Manutenção do R2 (Cloudflare)](#5-manutenção-do-r2-cloudflare)
6. [Problemas comuns e soluções](#6-problemas-comuns-e-soluções)
7. [Variáveis de ambiente (.env)](#7-variáveis-de-ambiente-env)
8. [Comandos úteis](#8-comandos-úteis)

---

## 1. O que é o LiveBridge?

O LiveBridge é uma plataforma que permite:

- **Transmitir aulas ao vivo** — o professor usa o OBS para enviar o vídeo
- **Assistir ao vivo** — os alunos entram no player e assistem em tempo real
- **Gravar as aulas** — ao final da transmissão, o vídeo é salvo na nuvem (R2 da Cloudflare)
- **Assistir gravações** — os alunos podem ver as aulas gravadas depois

---

## 2. Visão geral do fluxo

```
OBS (professor)  →  RTMP (porta 1935)  →  MediaMTX  →  HLS (porta 8888)  →  Player (alunos)
                         ↓
                  Grava em disco
                         ↓
                  Merge (concatena)  →  R2 Cloudflare (gravações)
```

**Em palavras simples:**

1. O professor abre o OBS e transmite para o servidor.
2. O **MediaMTX** recebe o vídeo e grava em pedaços (.ts) no disco.
3. Os alunos assistem ao vivo pelo player (HLS).
4. Quando o professor para a transmissão, o **Merge** junta os pedaços em um MP4 e envia para o **R2** (Cloudflare).
5. As gravações ficam disponíveis na aba "Gravações" do player.

---

## 3. Acessando o servidor

### 3.1 Conectar por SSH

Se você usa Windows, pode usar **PuTTY** ou o **Terminal** do Windows. No Mac/Linux, use o Terminal.

```bash
ssh root@IP_DO_SERVIDOR
```

Substitua `IP_DO_SERVIDOR` pelo IP da sua VPS (ex: `123.45.67.89`).

### 3.2 Ir até a pasta do projeto

```bash
cd ~/livebridge/server
```

(ou o caminho onde o projeto está instalado, ex: `cd /root/livebridge/server`)

---

## 4. Manutenção do RTMP/HLS (transmissão ao vivo)

O **MediaMTX** é o programa que recebe o vídeo do OBS (RTMP) e distribui para os alunos (HLS).

### 4.1 Onde está a configuração?

Arquivo: `server/mediamtx/mediamtx.yml`

### 4.2 Principais configurações

| Configuração | O que faz | Valor atual |
|-------------|-----------|-------------|
| `rtmpAddress: :1935` | Porta onde o OBS envia o vídeo | 1935 |
| `hlsAddress: :8888` | Porta do HLS (player assiste por aqui) | 8888 |
| `hlsSegmentCount: 28800` | Quantos minutos de DVR (voltar no tempo) | 8 horas |
| `hlsSegmentDuration: 1s` | Duração de cada pedaço | 1 segundo |
| `record: yes` | Se grava ou não | Sim |
| `recordPath` | Onde salva os pedaços | `/recordings/...` |

### 4.3 Reiniciar o MediaMTX

Se a transmissão parar de funcionar ou travar:

```bash
cd ~/livebridge/server
docker compose restart mediamtx
```

### 4.4 Ver os logs do MediaMTX

```bash
docker logs --tail 100 livebridge-mediamtx
```

### 4.5 Liberar portas no firewall

O OBS precisa da **porta 1935** (RTMP) aberta. O player precisa da **porta 8081** (ou a que você usa).

**No painel da Hostinger (hPanel):**
1. Vá em **VPS** → **Firewall**
2. Adicione regra: **Accept** → **TCP** → **1935** → **Anywhere**
3. Adicione regra: **Accept** → **TCP** → **8081** → **Anywhere**

### 4.6 Configuração do OBS (para o professor)

| Campo | Valor |
|-------|-------|
| **Servidor** | `rtmp://IP_DO_SERVIDOR:1935/live` |
| **Chave de transmissão** | Qualquer nome (ex: `matematica`, `aula1`) |

Exemplo completo: `rtmp://123.45.67.89:1935/live` e chave `matematica`.

---

## 5. Manutenção do R2 (Cloudflare)

O **R2** é o armazenamento de nuvem da Cloudflare onde ficam as gravações em MP4.

### 5.1 Onde configurar o R2?

Arquivo: `server/.env`

Variáveis necessárias:

```
R2_ACCOUNT_ID=seu_account_id
R2_ACCESS_KEY=sua_access_key
R2_SECRET_KEY=sua_secret_key
R2_BUCKET=nome_do_bucket
```

### 5.2 Como obter as chaves do R2

1. Acesse o painel da **Cloudflare** (cloudflare.com)
2. Vá em **R2 Object Storage**
3. Crie um **bucket** (ex: `livebridge`) se ainda não existir
4. Vá em **Manage R2 API Tokens**
5. Crie um token com permissão de **Object Read & Write**
6. Copie o **Account ID**, **Access Key** e **Secret Key**
7. Cole no arquivo `.env`

### 5.3 Estrutura das gravações no R2

Os vídeos ficam em:

```
recordings/videos/live/NOME_DO_STREAM/YYYY-MM-DD_HH-MM-SS.mp4
```

Exemplo: `recordings/videos/live/matematica/2026-03-10_14-30-00.mp4`

### 5.4 Ver gravações no painel da Cloudflare

1. Cloudflare → R2 → seu bucket
2. Navegue até `recordings/videos/live/`
3. Cada pasta é um stream (ex: `matematica`), dentro tem os MP4s

### 5.5 Apagar gravações antigas

Pelo painel da Cloudflare:
1. R2 → bucket → navegue até o arquivo
2. Selecione e clique em **Delete**

Ou use a API/CLI da Cloudflare (requer conhecimento técnico).

### 5.6 Verificar se o R2 está funcionando

```bash
docker logs --tail 20 livebridge-merge
```

Deve aparecer algo como: `[merge] R2 bucket "livebridge" acessível`

---

## 6. Problemas comuns e soluções

### 6.1 OBS dá "conexão expirou"

- **Causa:** Firewall bloqueando a porta 1935
- **Solução:** Libere a porta 1935 no firewall (ver item 4.5)

### 6.2 Alunos não conseguem assistir ao vivo

- **Causa 1:** MediaMTX parado
- **Solução:** `docker compose restart mediamtx`

- **Causa 2:** Professor não iniciou a transmissão no OBS
- **Solução:** Verificar se o OBS está transmitindo

- **Causa 3:** Nome do stream errado
- **Solução:** O nome no player deve ser igual à chave usada no OBS

### 6.3 Gravação não aparece na aba "Gravações"

- **Causa 1:** Merge ainda processando (vídeos longos demoram)
- **Solução:** Aguardar. Um vídeo de 1h30 pode levar ~2h para processar

- **Causa 2:** R2 não configurado ou chaves erradas
- **Solução:** Verificar o `.env` e os logs do merge: `docker logs livebridge-merge`

- **Causa 3:** Merge falhou
- **Solução:** Ver logs: `docker logs livebridge-merge`. Se aparecer "ffmpeg falhou" ou "Upload R2 falhou", pode ser falta de espaço em disco ou erro nas chaves do R2

### 6.4 Vídeo travando ou com delay alto

- **Causa:** Internet do professor ou do servidor lenta
- **Solução:** Reduzir qualidade no OBS (ex: 720p, 4000 kbps) ou melhorar a conexão

### 6.5 "Acesso negado" ao assistir vídeo

- **Causa:** Cookie de sessão expirado ou bloqueado
- **Solução:** Pedir ao aluno para recarregar a página (F5) ou limpar o cache do navegador

### 6.6 Servidor sem espaço em disco

O MediaMTX grava pedaços em disco antes do merge. Vídeos longos ocupam bastante espaço.

**Ver espaço disponível:**
```bash
df -h
```

**Limpar gravações antigas já enviadas ao R2:**
As pastas em `server/recordings/live/` podem ser limpas manualmente se os vídeos já estiverem no R2. **Cuidado:** só apague se tiver certeza de que o merge já fez o upload.

---

## 7. Variáveis de ambiente (.env)

O arquivo `server/.env` controla o comportamento da aplicação.

### 7.1 R2 (obrigatório para gravações)

| Variável | O que é |
|----------|---------|
| `R2_ACCOUNT_ID` | ID da conta Cloudflare |
| `R2_ACCESS_KEY` | Chave de acesso da API |
| `R2_SECRET_KEY` | Chave secreta da API |
| `R2_BUCKET` | Nome do bucket (ex: `livebridge`) |

### 7.2 Merge (gravações)

| Variável | O que faz | Padrão |
|----------|------------|--------|
| `COMPRESS_VIDEO` | 1 = comprime, 0 = só copia (mais rápido, arquivo maior) | 1 |
| `COMPRESS_CODEC` | `h265` (menor arquivo) ou `h264` (compatibilidade) | h265 |
| `COMPRESS_PRESET` | `veryslow` = máx. compressão (lento); `fast`/`veryfast` = mais rápido | veryslow |
| `COMPRESS_CRF` | CRF único (fallback); HEVC ~26–30, H.264 ~20–24 | 28 |
| `COMPRESS_CRF_H264` / `COMPRESS_CRF_H265` | CRF por codec (sobrescreve o genérico por codec) | 23 / 28 |
| `COMPRESS_AUDIO_BITRATE` | AAC (ex: `64k`, `96k`) | 64k |
| `FFMPEG_TIMEOUT_MS` | Tempo máximo do merge em ms (43200000 = 12h) | 43200000 |

**Dica:** Padrão atual prioriza **menor arquivo** (HEVC + veryslow). Para processar mais rápido: `COMPRESS_PRESET=fast` ou `COMPRESS_CODEC=h264` + `COMPRESS_PRESET=veryfast`.

### 7.3 API (opcional)

| Variável | O que faz |
|----------|-----------|
| `LESSONS_API_URL` | URL da API de aulas (metadata) |
| `LESSONS_API_TOKEN` | Token de acesso |
| `SKIP_LESSONS_API` | 1 = não usa API de metadata |

**Depois de alterar o .env**, reinicie os containers:

```bash
docker compose down
docker compose up -d
```

---

## 8. Comandos úteis

### Subir a aplicação
```bash
cd ~/livebridge/server
docker compose up -d
```

### Parar a aplicação
```bash
docker compose down
```

### Ver status dos containers
```bash
docker compose ps
```

### Ver logs em tempo real
```bash
# MediaMTX (transmissão)
docker logs -f livebridge-mediamtx

# Merge (gravações)
docker logs -f livebridge-merge

# API
docker logs -f livebridge-api
```

### Reiniciar um serviço específico
```bash
docker compose restart mediamtx   # só transmissão
docker compose restart merge      # só merge/gravações
docker compose restart api        # só API
```

### Atualizar a aplicação (após git pull)
```bash
cd ~/livebridge/server
docker compose build
docker compose up -d
```

### Ver uso de disco
```bash
df -h
du -sh server/recordings
```

---

## Resumo rápido

| O que fazer | Comando ou local |
|-------------|------------------|
| Reiniciar transmissão | `docker compose restart mediamtx` |
| Ver logs do merge | `docker logs livebridge-merge` |
| Configurar R2 | Editar `server/.env` |
| Configurar RTMP/HLS | Editar `server/mediamtx/mediamtx.yml` |
| Liberar porta OBS | Firewall: abrir 1935 TCP |
| Subir tudo | `docker compose up -d` |
| Parar tudo | `docker compose down` |

---

*Documento criado para manutenção do LiveBridge — RTMP/HLS e R2 Cloudflare.*
