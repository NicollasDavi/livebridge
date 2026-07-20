# LiveBridge — CI/CD (sem SSH)

A VM GCP **não recebe SSH** do GitHub. O fluxo é:

1. **GitHub Actions** → CI + build/push de imagens para **Artifact Registry** + manifesto no **GCS**  
2. **VM** (timer local) → lê o GCS (outbound) → `git pull` → `docker compose pull/up`

Pipeline: [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml)

```text
PR / push main
    │
    ▼
  CI (npm, syntax, compose, shellcheck)
    │
    │  só main / dispatch
    ▼
  Publish (WIF → GCP)
    ├─ docker push api + merge → Artifact Registry
    └─ gs://BUCKET/livebridge/deploy-manifest.json
    │
    ▼
  VM systemd timer (a cada 2 min)
    ├─ gcloud storage cp manifesto
    ├─ git pull (HTTPS outbound)
    └─ docker compose pull api merge && up -d
```

---

## Jobs

| Job | Quando | O quê |
|-----|--------|--------|
| **CI** | PR + push `main` | Validação Node + compose + shellcheck |
| **Publish** | Após CI na `main` (ou dispatch) | Push imagens AR + manifesto GCS |

Não há passo SSH.

---

## Secrets e variáveis (GitHub)

### Secrets

| Secret | Descrição |
|--------|-----------|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Provider WIF (ex. `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`) |
| `GCP_SERVICE_ACCOUNT` | SA de deploy (ex. `livebridge-deploy@PROJECT.iam.gserviceaccount.com`) |
| `GCP_PROJECT_ID` | ID do projeto GCP |
| `GCS_DEPLOY_BUCKET` | Bucket do manifesto (com ou sem `gs://`) |

### Variables (opcional)

| Variable | Default | Descrição |
|----------|---------|-----------|
| `GCP_REGION` | `southamerica-east1` | Região do Artifact Registry |
| `ARTIFACT_REGISTRY_REPO` | `livebridge` | Nome do repositório AR |

---

## Setup GCP (uma vez)

### 1. Artifact Registry

```bash
gcloud artifacts repositories create livebridge \
  --repository-format=docker \
  --location=southamerica-east1 \
  --description="LiveBridge images"
```

### 2. Bucket do manifesto

```bash
gcloud storage buckets create gs://SEU_BUCKET_DEPLOY \
  --location=southamerica-east1 \
  --uniform-bucket-level-access
```

### 3. Service account + WIF (GitHub → GCP)

```bash
PROJECT_ID="$(gcloud config get-value project)"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="livebridge-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create livebridge-deploy --display-name="LiveBridge GitHub Deploy"

gcloud artifacts repositories add-iam-policy-binding livebridge \
  --location=southamerica-east1 \
  --member="serviceAccount:${SA}" \
  --role="roles/artifactregistry.writer"

gcloud storage buckets add-iam-policy-binding gs://SEU_BUCKET_DEPLOY \
  --member="serviceAccount:${SA}" \
  --role="roles/storage.objectAdmin"

# Pool + provider (ajuste GITHUB_ORG/REPO)
gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
  --attribute-condition="assertion.repository=='ORG/livebridge'"

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/ORG/livebridge"
```

No GitHub, secret `GCP_WORKLOAD_IDENTITY_PROVIDER`:

`projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider`

### 4. VM — identidade para puxar imagens e GCS

Na VM (ou SA da instância):

- `roles/artifactregistry.reader` no repo `livebridge`  
- `roles/storage.objectViewer` no bucket do manifesto  

```bash
# login docker AR na VM (uma vez)
gcloud auth configure-docker southamerica-east1-docker.pkg.dev
```

### 5. VM — timer de pull (sem abrir SSH ao mundo)

Com acesso console / IAP / serial (o que a política permitir), **uma vez**:

```bash
sudo mkdir -p /etc/livebridge /var/lib/livebridge
sudo cp /opt/livebridge/server/scripts/systemd/pull-deploy.env.example /etc/livebridge/pull-deploy.env
sudo nano /etc/livebridge/pull-deploy.env
# LIVEBRIDGE_DIR=/opt/livebridge
# GCS_DEPLOY_URI=gs://SEU_BUCKET_DEPLOY/livebridge/deploy-manifest.json

sudo chmod +x /opt/livebridge/server/scripts/gcp-pull-deploy.sh
sudo cp /opt/livebridge/server/scripts/systemd/livebridge-pull-deploy.service /etc/systemd/system/
sudo cp /opt/livebridge/server/scripts/systemd/livebridge-pull-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now livebridge-pull-deploy.timer
sudo systemctl list-timers | grep livebridge
```

O script:

1. Lê `deploy-manifest.json` no GCS  
2. Se o `sha` mudou → `git pull` + `docker compose pull api merge` + `up -d`  
3. Guarda o último sha em `/var/lib/livebridge/last-deploy-sha`

Configs (`nginx/`, `mediamtx/`) vêm do **git pull** (HTTPS outbound). Imagens `api`/`merge` vêm do **Artifact Registry**.

---

## Compose / imagens

Em `docker-compose.yml`:

- `API_IMAGE` / `MERGE_IMAGE` — se definidos, o compose usa essas imagens  
- Local sem env: build `livebridge-api:local` / `livebridge-merge:local`

O script de pull exporta as imagens do manifesto automaticamente.

---

## Fluxo do dia a dia

1. PR → só CI  
2. Merge em `main` → CI → publish imagens + GCS  
3. Em até ~2 min a VM aplica o deploy  

Dispatch manual: Actions → **CI/CD LiveBridge** → Run workflow.

---

## Troubleshooting

| Sintoma | Verificar |
|---------|-----------|
| Publish falha auth | WIF + binding `workloadIdentityUser` + secrets |
| VM não atualiza | `journalctl -u livebridge-pull-deploy.service -n 50` |
| `denied` no docker pull | SA da VM com `artifactregistry.reader` + `configure-docker` |
| Config nginx antiga | `git pull` na VM / remote HTTPS do repo |
| Manifesto 404 | path `gs://BUCKET/livebridge/deploy-manifest.json` e permissões |

---

## O que não fazer

- Não voltar a usar `appleboy/ssh-action` nesta VM  
- Não expor porta 22 na internet só para deploy  
- Não commitar `.env` de produção (continua só na VM)
