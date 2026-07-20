# LiveBridge — CI/CD (imagens no GHCR)

Sem GCP. O fluxo é:

1. **GitHub Actions** → CI + build/push de imagens `api` e `merge` para o **GitHub Container Registry** (`ghcr.io`)
2. **VM** → pull manual das imagens quando for atualizar

Pipeline: [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml)

```text
PR / push main
    │
    ▼
  CI (npm, syntax, compose, shellcheck)
    │
    │  só main / dispatch
    ▼
  Publish (GITHUB_TOKEN → ghcr.io)
    └─ docker push api + merge
    │
    ▼
  Na VM (manual)
    ├─ git pull
    └─ docker compose pull api merge && up -d
```

---

## Jobs

| Job | Quando | O quê |
|-----|--------|--------|
| **CI** | PR + push `main` | Validação Node + compose + shellcheck |
| **Publish** | Após CI na `main` (ou dispatch) | Push imagens para `ghcr.io` |

Não há secrets GCP, SSH nem manifesto.

---

## Imagens

Para o repositório `ORG/livebridge`:

| Serviço | Imagem |
|---------|--------|
| API | `ghcr.io/org/livebridge/api:latest` |
| Merge | `ghcr.io/org/livebridge/merge:latest` |

Também são publicadas tags com o SHA completo e os 7 primeiros caracteres do commit.

---

## VM — pull manual

No `.env` da VM:

```bash
API_IMAGE=ghcr.io/ORG/livebridge/api:latest
MERGE_IMAGE=ghcr.io/ORG/livebridge/merge:latest
```

Se o pacote for **privado**, autenticar o Docker uma vez (PAT com `read:packages`):

```bash
echo SEU_PAT | docker login ghcr.io -u SEU_USER --password-stdin
```

Atualizar:

```bash
cd /opt/livebridge
git pull
docker compose pull api merge
docker compose up -d
```

Configs (`nginx/`, `mediamtx/`) vêm do **git pull**. Imagens `api`/`merge` vêm do **GHCR**.

Para tornar os pacotes públicos (pull sem login): GitHub → Packages → package → Package settings → Change visibility.

---

## Compose / imagens

Em `docker-compose.yml`:

- `API_IMAGE` / `MERGE_IMAGE` — se definidos, o compose usa essas imagens  
- Local sem env: build `livebridge-api:local` / `livebridge-merge:local`

---

## Fluxo do dia a dia

1. PR → só CI  
2. Merge em `main` → CI → publish no GHCR  
3. Na VM, quando quiser: `git pull` + `docker compose pull api merge` + `up -d`

Dispatch manual: Actions → **CI/CD LiveBridge** → Run workflow.

---

## Troubleshooting

| Sintoma | Verificar |
|---------|-----------|
| Publish falha no push | `permissions.packages: write` no job; package ligado ao repo |
| `denied` no docker pull | login `ghcr.io` com PAT `read:packages`, ou pacote público |
| Config nginx antiga | `git pull` na VM |

---

## O que não fazer

- Não usar GCP / Artifact Registry neste pipeline  
- Não expor porta 22 na internet só para deploy  
- Não commitar `.env` de produção (continua só na VM)
