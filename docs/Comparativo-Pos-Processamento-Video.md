# Comparativo Técnico: Três Abordagens de Pós-Processamento de Vídeo

**Documento técnico completo**  
*PosiLive – Análise detalhada das estratégias de compressão e disponibilização de gravações*

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Pré-requisitos e Contexto](#2-pré-requisitos-e-contexto)
3. [Abordagem A: Compressão por Segmento](#3-abordagem-a-compressão-por-segmento)
4. [Abordagem B: Copy + Preset Slow em Background](#4-abordagem-b-copy--preset-slow-em-background)
5. [Abordagem C: Servir .ts na VM e Compactar em Paralelo](#5-abordagem-c-servir-ts-na-vm-e-compactar-em-paralelo-mais-barata-e-viável)
6. [Comparativo Direto](#6-comparativo-direto)
7. [Estimativas de Custo Detalhadas](#7-estimativas-de-custo-detalhadas)
8. [Código de Referência Completo](#8-código-de-referência-completo)
9. [Cenários e Recomendações](#9-cenários-e-recomendações)
10. [Alternativas e Híbridos](#10-alternativas-e-híbridos)
11. [Detalhes Adicionais](#11-detalhes-adicionais)
12. [Monitoramento e Troubleshooting](#12-monitoramento-e-troubleshooting)
13. [Resumo Executivo](#13-resumo-executivo)

---

## 1. Visão Geral

### 1.1 As Três Abordagens

| Abordagem | Descrição resumida |
|-----------|-------------------|
| **A** | Comprimir cada segmento `.ts` assim que é criado durante a live. Ao final, concatenar e enviar para o R2. |
| **B** | Concatenar `.ts` em MP4 (copy) e servir da VM. Em paralelo, comprimir com preset slow e enviar para o R2 quando pronto. |
| **C** | Servir os `.ts` que ficam na VM (HLS) e compactar em paralelo. Alunos assistem os segmentos direto da VM. Ao final, concat + preset slow e upload para o R2. A mais barata e viável. |

### 1.2 Trade-off Principal

```
Abordagem A: Velocidade + Simplicidade de destino  vs  Tamanho ~5-15% maior
Abordagem B: Máxima compressão  vs  Egress GCP + Concat temp antes de servir
Abordagem C: Servir .ts direto + compactar em paralelo  vs  Egress GCP (menor que B)
```

---

## 2. Pré-requisitos e Contexto

### 2.1 Cenário Base

| Parâmetro | Valor |
|-----------|-------|
| Duração da live | 45–50 min |
| Segmentos | 6–8 s cada |
| Qualidades | 1080p, 720p, 480p |
| Codec live | H.264 (HLS) |
| Destino final | Cloudflare R2 |
| Prazo desejado | Vídeo disponível em até 15 min |

### 2.2 Tamanhos de Arquivo (Referência)

| Formato | 45 min 1080p |
|---------|--------------|
| .ts (raw) | ~4–5 GB |
| MP4 copy | ~4–5 GB |
| H.264 CRF 23 (preset fast) | ~1,5 GB |
| H.264 CRF 23 (preset slow) | ~1,0 GB |
| H.265 CQ 23 (hevc_nvenc p7) | ~1,0–1,1 GB |
| H.265 por segmento | ~1,05–1,2 GB |

### 2.3 Regiões e Preços GCP (Referência)

| Região | vCPU/h | Egress/GB |
|--------|--------|-----------|
| southamerica-east1 (SP) | ~0,04 | ~0,12 |
| southamerica-west1 (Chile) | ~0,032 | ~0,12 |
| northamerica-south1 (México) | ~0,025 | ~0,12 |

---

## 3. Abordagem A: Compressão por Segmento

### 3.1 Fluxo Técnico Detalhado

```
[Durante a live - 45 min]
  FFmpeg (live) → segmentos .ts
       │
       ├─ inotifywait detecta close_write em /recordings/live_1080p/
       ├─ Para cada novo segN.ts:
       │   ├─ FFmpeg: segN.ts → hevc_nvenc → segN.mp4 (1080p)
       │   ├─ FFmpeg: segN.ts → hevc_nvenc → segN.mp4 (720p)
       │   └─ FFmpeg: segN.ts → hevc_nvenc → segN.mp4 (480p)
       │   (3 processos em paralelo)

[Fim da live - sinal via arquivo ou API]
       │
       ├─ Ordenar seg*.mp4 por número
       ├─ ffmpeg -f concat -i list.txt -c copy final_1080p.mp4
       ├─ ffmpeg -f concat -i list.txt -c copy final_720p.mp4
       ├─ ffmpeg -f concat -i list.txt -c copy final_480p.mp4
       ├─ rclone copy final_*.mp4 r2:bucket/recordings/YYYY/MM/DD/
       └─ rm -rf segmentos .ts e .mp4 intermediários
```

### 3.2 Infraestrutura

| Componente | Especificação | Justificativa |
|------------|---------------|---------------|
| **VM** | n1-standard-8 ou e2-standard-8 | 8 vCPU para decode/scale/mux |
| **GPU** | NVIDIA T4 | NVENC para encode em ~1–2 s/segmento |
| **RAM** | 16 GB | 3 FFmpeg + live transcode |
| **Disco** | 100–200 GB SSD | .ts + .mp4 intermediários |
| **Região** | México ou Chile | Custo menor |

### 3.3 Tempos por Etapa

| Etapa | Duração |
|-------|---------|
| Compressão por segmento (8 s) | ~1–2 s (3 qualidades em paralelo) |
| Concat final | ~1–2 min |
| Upload R2 (3 qualidades) | ~2–4 min |
| **Total após live** | **~3–6 min** |

### 3.4 Configuração FFmpeg (hevc_nvenc)

```bash
# 1080p - qualidade máxima NVENC
ffmpeg -y -i seg.ts \
  -c:v hevc_nvenc -preset p7 -tune hq \
  -rc vbr -cq 23 -b:v 0 \
  -rc-lookahead 32 -bf 4 \
  -vf scale=1920:1080 \
  -c:a aac -b:a 128k \
  seg.mp4

# 720p
ffmpeg -y -i seg.ts \
  -c:v hevc_nvenc -preset p7 -tune hq \
  -rc vbr -cq 23 -b:v 0 \
  -rc-lookahead 32 -bf 4 \
  -vf scale=1280:720 \
  -c:a aac -b:a 128k \
  seg.mp4

# 480p
ffmpeg -y -i seg.ts \
  -c:v hevc_nvenc -preset p7 -tune hq \
  -rc vbr -cq 23 -b:v 0 \
  -rc-lookahead 32 -bf 4 \
  -vf scale=854:480 \
  -c:a aac -b:a 96k \
  seg.mp4
```

### 3.5 Tamanho e Qualidade

| Métrica | Valor |
|---------|-------|
| Tamanho 45 min 1080p | ~1,05–1,15 GB |
| vs preset slow | ~5–15% maior |
| Causa | Keyframe a cada 6–8 s, GOP limitado por segmento |

### 3.6 Custos Mensais

| Item | Valor |
|------|-------|
| VM n1-standard-8 + T4 (México) | ~US$ 280 |
| Disco 100 GB | ~US$ 5 |
| R2 7 TB | ~US$ 105 |
| Egress R2 | US$ 0 |
| **Total** | **~US$ 390** |

### 3.7 Vantagens

- Vídeo disponível em 3–6 min
- Sem copy temporário no R2 (sem pico de storage)
- Sem egress da VM para streaming
- Um único destino final (R2)
- Carga distribuída durante a live
- GPU faz o trabalho pesado

### 3.8 Ações Necessárias (durante a live)

| Quem | Ação |
|------|------|
| **Operador de câmera** (ou quem transmite) | Clicar em botão **"Aula acabou"** no painel/interface da live |
| **Sistema** | Recebe o sinal (API ou webhook) e dispara concat + upload para R2 |

### 3.9 Desvantagens

- Arquivos ~5–15% maiores
- Depende de GPU
- Implementação mais complexa (watcher, concat, limpeza)
- H.265 com suporte limitado em alguns navegadores

---

## 4. Abordagem B: Copy + Preset Slow em Background

### 4.1 Fluxo Técnico Detalhado

```
[Fim da live]
  1. Concat .ts → MP4 (copy)
     ffmpeg -f concat -safe 0 -i list.txt -c copy temp_1080p.mp4
     Tempo: ~2–3 min
  2. MP4 em /recordings/temp/
  3. Nginx (ou similar) serve temp_1080p.mp4
     URL: https://vm.example.com/recordings/aula_123_1080p.mp4
  4. Alunos assistem → egress GCP

[Em paralelo - background]
  5. ffmpeg -i temp_1080p.mp4 -c:v libx264 -preset slow -crf 23 ...
     Tempo: ~90–120 min (1080p)
  6. 720p: ~60–80 min
  7. 480p: ~40–50 min
  8. 3 em paralelo → gargalo 1080p ~2 h
  9. Upload final_*.mp4 para R2
  10. Atualizar URL no sistema (VM → R2)
  11. rm temp_*.mp4
```

### 4.2 Infraestrutura

| Componente | Especificação | Justificativa |
|------------|---------------|---------------|
| **VM** | e2-standard-16 ou n1-standard-16 | 16 vCPU para preset slow |
| **GPU** | Não | libx264 preset slow |
| **RAM** | 32 GB | 3 processos libx264 |
| **Disco** | 200–300 GB SSD | temp + comprimido |
| **Rede** | Egress GCP | Streaming do temp |

### 4.3 Tempos por Etapa

| Etapa | Duração |
|-------|---------|
| Concat .ts → MP4 | ~2–3 min |
| **Vídeo disponível (temp)** | **~5 min** |
| Encode preset slow | ~90–120 min |
| Upload R2 | ~2–3 min |
| **Versão final no R2** | **~2 h** |

### 4.4 Configuração FFmpeg (libx264 preset slow)

```bash
# 1080p
ffmpeg -y -i temp_1080p.mp4 \
  -c:v libx264 -preset slow -crf 23 \
  -profile high -level 4.1 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  final_1080p.mp4

# 720p
ffmpeg -y -i temp_720p.mp4 \
  -c:v libx264 -preset slow -crf 23 \
  -profile high -level 4.0 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  final_720p.mp4

# 480p
ffmpeg -y -i temp_480p.mp4 \
  -c:v libx264 -preset slow -crf 23 \
  -profile high -level 3.1 \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  final_480p.mp4
```

### 4.5 Tamanho e Qualidade

| Métrica | Valor |
|---------|-------|
| Tamanho 45 min 1080p | ~0,9–1,0 GB |
| Qualidade | Máxima (preset slow) |

### 4.6 Custos Mensais

| Item | Valor |
|------|-------|
| VM e2-standard-16 (México) | ~US$ 280 |
| Disco 200 GB | ~US$ 10 |
| R2 7 TB (arquivos menores) | ~US$ 95 |
| **Egress GCP** | **Variável** |

### 4.7 Custo de Egress GCP (Streaming do Temp)

| Visualizações (2 h) | GB (1,5 GB/vídeo) | Custo (~US$ 0,12/GB) |
|---------------------|-------------------|------------------------|
| 20 | 30 | ~US$ 3,60 |
| 50 | 75 | ~US$ 9 |
| 100 | 150 | ~US$ 18 |
| 200 | 300 | ~US$ 36 |
| 500 | 750 | ~US$ 90 |
| 1000 | 1500 | ~US$ 180 |

### 4.8 Vantagens

- Máxima compressão (preset slow)
- Vídeo disponível em ~5 min (temp)
- Sem GPU
- Compatibilidade total (H.264)
- Arquivo final menor no R2

### 4.9 Ações Necessárias (durante a live)

| Quem | Ação |
|------|------|
| **Operador de câmera** (ou quem transmite) | Clicar em botão **"Aula acabou"** no painel/interface da live |
| **Sistema** | Recebe o sinal e dispara concat .ts → MP4 (copy) + disponibiliza para streaming + inicia compressão em background |

### 4.10 Desvantagens

- Egress GCP para streaming do temp
- Dois períodos (temp na VM, depois R2)
- Troca de URL quando comprimido sobe
- ~2 h para versão final
- VM maior (16 vCPU, 32 GB)

---

## 5. Abordagem C: Servir .ts na VM e Compactar em Paralelo *(mais barata e viável)*

### 5.1 Fluxo Técnico Detalhado

```
[Fim da live]
  1. Os .ts já estão em disco (MediaMTX ou similar gravou)
  2. Servir os .ts como HLS direto da VM → alunos assistem imediatamente
     (sem concat, sem temp MP4)
  3. Vídeo disponível: imediato

[Em paralelo - background]
  4. Concat .ts → MP4 (copy) → ffmpeg -c:v libx264 -preset slow ...
     Tempo: ~90–120 min (1080p)
  5. 720p: ~60–80 min | 480p: ~40–50 min
  6. Upload final_*.mp4 para R2
  7. Atualizar URL no sistema (VM → R2)
  8. rm .ts (após período de retenção)
```

### 5.2 Infraestrutura

| Componente | Especificação | Justificativa |
|------------|---------------|---------------|
| **VM** | e2-standard-16 ou n1-standard-16 | 16 vCPU para preset slow |
| **GPU** | Não | libx264 preset slow |
| **RAM** | 32 GB | 3 processos libx264 |
| **Disco** | 150–250 GB SSD | .ts + comprimido (sem temp MP4) |
| **Rede** | Egress GCP | Streaming dos .ts da VM |

### 5.3 Tempos por Etapa

| Etapa | Duração |
|-------|---------|
| **Vídeo disponível (HLS .ts)** | **Imediato** |
| Encode preset slow | ~90–120 min |
| Upload R2 | ~2–3 min |
| **Versão final no R2** | **~2 h** |

### 5.4 Configuração FFmpeg (libx264 preset slow)

Idêntica à Abordagem B (ver seção 4.4).

### 5.5 Tamanho e Qualidade

| Métrica | Valor |
|---------|-------|
| .ts (servidos da VM) | ~4–5 GB (45 min 1080p) |
| Versão final (preset slow) | ~0,9–1,0 GB |
| Qualidade final | Máxima (preset slow) |

### 5.6 Custos Mensais

| Item | Valor |
|------|-------|
| VM e2-standard-16 (México) | ~US$ 280 |
| Disco 150 GB | ~US$ 8 |
| R2 7 TB (arquivos menores) | ~US$ 95 |
| **Egress GCP** | **Variável** (menor que B: não há concat temp) |

**Por que mais barata:** Não precisa concat .ts → MP4 antes de servir. Os .ts são servidos direto. Menos disco, menos CPU, menos etapas. O egress existe (alunos assistem da VM), mas o pipeline é mais simples e barato.

### 5.7 Vantagens

- Vídeo disponível **imediatamente**
- A mais barata e viável das três
- Sem GPU
- Sem temp MP4 (menos disco, menos processamento)
- Máxima compressão (preset slow) na versão final
- Compatibilidade total (H.264)

### 5.8 Ações Necessárias (durante a live)

| Quem | Ação |
|------|------|
| **Operador de câmera** (ou quem transmite) | Clicar em botão **"Aula acabou"** no painel/interface da live |
| **Sistema** | Recebe o sinal; os .ts já estão em disco e passam a ser servidos imediatamente; inicia concat + compress + upload em background |

### 5.9 Desvantagens

- Egress GCP para streaming dos .ts (como B)
- ~2 h para versão final comprimida
- Troca de URL quando comprimido sobe para R2

---

## 6. Comparativo Direto

| Critério | Abordagem A | Abordagem B | Abordagem C |
|----------|-------------|-------------|-------------|
| Tempo até disponível | 3–6 min | ~5 min | Imediato |
| Tempo até versão final | 3–6 min | ~2 h | ~2 h |
| Tamanho 45 min 1080p | ~1,05–1,15 GB | ~0,9–1,0 GB | ~0,9–1,0 GB |
| GPU | Obrigatória (T4) | Não | Não |
| vCPU | 8 | 16 | 16 |
| RAM | 16 GB | 32 GB | 32 GB |
| Disco | 100–200 GB | 200–300 GB | 200–300 GB |
| Egress GCP | 0 | Variável | Variável |
| Custo VM | ~US$ 280 (com GPU) | ~US$ 280 (sem GPU) | ~US$ 280 (sem GPU) |
| Custo R2 (7 TB) | ~US$ 105 | ~US$ 95 | ~US$ 95 |
| Troca de URL | Não | Sim | Sim |
| Complexidade | Maior | Média | Média |
| **Ação durante a live** | Operador clica "Aula acabou" | Operador clica "Aula acabou" | Operador clica "Aula acabou" |

---

## 7. Estimativas de Custo Detalhadas

### 7.1 Abordagem A – Custo Anual

| Item | Mensal | Anual |
|------|--------|-------|
| VM + GPU | 280 | 3.360 |
| Disco | 5 | 60 |
| R2 | 105 | 1.260 |
| Egress | 0 | 0 |
| **Total** | **390** | **4.680** |

### 7.2 Abordagem B – Custo Anual (Cenários)

**Cenário 1: 20 views/temp por aula, 200 aulas/ano**

| Item | Mensal | Anual |
|------|--------|-------|
| VM | 280 | 3.360 |
| Disco | 10 | 120 |
| R2 | 95 | 1.140 |
| Egress (20 × 1,5 GB × 200) | 60 | 720 |
| **Total** | **445** | **5.340** |

**Cenário 2: 100 views/temp por aula**

| Item | Anual |
|------|-------|
| Egress (100 × 1,5 GB × 200) | 3.600 |
| **Total** | **8.220** |

**Cenário 3: 500 views/temp por aula**

| Item | Anual |
|------|-------|
| Egress | 18.000 |
| **Total** | **22.620** |

### 7.3 Abordagem C – Custo Anual

| Item | Mensal | Anual |
|------|--------|-------|
| VM | 280 | 3.360 |
| Disco | 8 | 96 |
| R2 | 95 | 1.140 |
| Egress | Variável (menor que B) | Variável |
| **Total (poucos acessos)** | **~US$ 383** | **~US$ 4.596** |
| **Total (muitos acessos)** | Variável | Variável |

---

## 8. Código de Referência Completo

### 8.1 Abordagem A – Watcher (segment-compress-watcher.sh)

```bash
#!/bin/bash
set -e

RECORDINGS_BASE="/recordings"
QUALITIES=("1080p" "720p" "480p")

for QUALITY in "${QUALITIES[@]}"; do
  IN_DIR="$RECORDINGS_BASE/live_$QUALITY"
  OUT_DIR="$RECORDINGS_BASE/compressed_$QUALITY"
  mkdir -p "$OUT_DIR"

  case $QUALITY in
    1080p) SCALE="1920:1080"; AUDIO="128k" ;;
    720p)  SCALE="1280:720";  AUDIO="128k" ;;
    480p)  SCALE="854:480";   AUDIO="96k" ;;
  esac

  inotifywait -m -e close_write --format '%f' "$IN_DIR" | while read file; do
    if [[ "$file" == *.ts ]]; then
      base="${file%.ts}"
      ffmpeg -y -i "$IN_DIR/$file" \
        -c:v hevc_nvenc -preset p7 -tune hq -rc vbr -cq 23 -b:v 0 \
        -rc-lookahead 32 -bf 4 \
        -vf "scale=$SCALE" \
        -c:a aac -b:a $AUDIO \
        "$OUT_DIR/${base}.mp4"
    fi
  done &
done

wait
```

### 8.2 Abordagem A – Concat e Upload (concat-upload.sh)

```bash
#!/bin/bash
set -e

RECORDINGS_BASE="/recordings"
R2_BUCKET="r2:bucket/recordings"
DATE_PATH=$(date +%Y/%m/%d)
STREAM_ID="${1:-stream_001}"

for QUALITY in 1080p 720p 480p; do
  COMPRESSED_DIR="$RECORDINGS_BASE/compressed_$QUALITY"
  mkdir -p "$COMPRESSED_DIR"
  cd "$COMPRESSED_DIR"

  ls -1v seg*.mp4 2>/dev/null | while read f; do echo "file '$f'"; done > list.txt
  ffmpeg -y -f concat -safe 0 -i list.txt -c copy "$RECORDINGS_BASE/final_${QUALITY}.mp4"

  rclone copy "$RECORDINGS_BASE/final_${QUALITY}.mp4" "$R2_BUCKET/$DATE_PATH/" \
    --config /rclone/rclone.conf \
    -v

  # Limpeza
  rm -f "$COMPRESSED_DIR"/*.mp4 "$COMPRESSED_DIR"/list.txt
done
```

### 8.3 Abordagem B – Pipeline Completo (copy-slow-upload.sh)

```bash
#!/bin/bash
set -e

STREAM_ID="${1:-stream_001}"
RECORDINGS_BASE="/recordings"
TEMP_DIR="$RECORDINGS_BASE/temp"
FINAL_DIR="$RECORDINGS_BASE/final"
WEB_DIR="/var/www/recordings"
R2_BUCKET="r2:bucket/recordings"
DATE_PATH=$(date +%Y/%m/%d)

mkdir -p "$TEMP_DIR" "$FINAL_DIR"

for QUALITY in 1080p 720p 480p; do
  TS_DIR="$RECORDINGS_BASE/live_$QUALITY"
  ls -1v "$TS_DIR"/*.ts 2>/dev/null | while read f; do echo "file '$f'"; done > list.txt

  # 1. Concat (copy)
  ffmpeg -y -f concat -safe 0 -i list.txt -c copy "$TEMP_DIR/temp_${QUALITY}.mp4"

  # 2. Disponibilizar para streaming (symlink)
  ln -sf "$TEMP_DIR/temp_${QUALITY}.mp4" "$WEB_DIR/${STREAM_ID}_${QUALITY}.mp4"

  # 3. Encode slow em background
  (
    case $QUALITY in
      1080p) LEVEL="4.1" ;;
      720p)  LEVEL="4.0" ;;
      480p)  LEVEL="3.1" ;;
    esac
    ffmpeg -y -i "$TEMP_DIR/temp_${QUALITY}.mp4" \
      -c:v libx264 -preset slow -crf 23 -profile high -level $LEVEL \
      -c:a aac -b:a 128k -movflags +faststart \
      "$FINAL_DIR/final_${QUALITY}.mp4"

    rclone copy "$FINAL_DIR/final_${QUALITY}.mp4" "$R2_BUCKET/$DATE_PATH/" -v
    # API: atualizar URL para R2
    rm -f "$TEMP_DIR/temp_${QUALITY}.mp4" "$WEB_DIR/${STREAM_ID}_${QUALITY}.mp4"
  ) &
done

wait
```

### 8.4 Abordagem C – Servir .ts + Concat + Slow em Background (serve-ts-slow-upload.sh)

```bash
#!/bin/bash
set -e

STREAM_ID="${1:-stream_001}"
RECORDINGS_BASE="/recordings"
FINAL_DIR="$RECORDINGS_BASE/final"
R2_BUCKET="r2:bucket/recordings"
DATE_PATH=$(date +%Y/%m/%d)

# Os .ts já estão em disco; MediaMTX ou Nginx serve HLS direto (vídeo disponível imediatamente)
# Este script roda em paralelo: concat + compress + upload

mkdir -p "$FINAL_DIR"

for QUALITY in 1080p 720p 480p; do
  TS_DIR="$RECORDINGS_BASE/live_$QUALITY"
  ls -1v "$TS_DIR"/*.ts 2>/dev/null | while read f; do echo "file '$f'"; done > list.txt

  (
    ffmpeg -y -f concat -safe 0 -i list.txt -c copy "$FINAL_DIR/temp_${QUALITY}.mp4"

    case $QUALITY in
      1080p) LEVEL="4.1" ;;
      720p)  LEVEL="4.0" ;;
      480p)  LEVEL="3.1" ;;
    esac
    ffmpeg -y -i "$FINAL_DIR/temp_${QUALITY}.mp4" \
      -c:v libx264 -preset slow -crf 23 -profile high -level $LEVEL \
      -c:a aac -b:a 128k -movflags +faststart \
      "$FINAL_DIR/final_${QUALITY}.mp4"

    rclone copy "$FINAL_DIR/final_${QUALITY}.mp4" "$R2_BUCKET/$DATE_PATH/${STREAM_ID}_${QUALITY}.mp4" -v
    rm -f "$FINAL_DIR/temp_${QUALITY}.mp4" "$FINAL_DIR/final_${QUALITY}.mp4"
  ) &
done

wait
```

---

## 9. Cenários e Recomendações

| Prioridade | Abordagem | Motivo |
|------------|-----------|--------|
| Menor tempo até disponível | A, B ou C | Todas ~5–7 min |
| Menor tamanho | B ou C | Preset slow |
| Menor custo total | A | Sem egress GCP |
| Sem egress GCP | A ou C | C: streaming do R2 |
| Sem GPU | B ou C | libx264 |
| Poucas views logo após live | B | Egress baixo |
| Muitas views logo após live | A ou C | Evita egress alto |
| Implementação mais simples | B ou C | Sem watcher |

---

## 10. Alternativas e Híbridos

### 10.1 Híbrido: A com libx264 preset fast (sem GPU)

- Comprimir por segmento com preset fast/veryfast
- 16 vCPU: ~6–7 s/segmento
- Não acompanha a live (337 × 6,5 s ≈ 37 min)
- Viável apenas se aceitar atraso de ~30 min

### 10.2 Híbrido: B com CDN na frente da VM

- Colocar Cloudflare na frente da VM para cache
- Reduz egress (cache hit não gera egress)
- Requer domínio e configuração

---

## 11. Detalhes Adicionais

### 11.1 Estrutura de Pastas no R2

```
bucket/
└── recordings/
    └── YYYY/
        └── MM/
            └── DD/
                ├── aula_001_1080p.mp4
                ├── aula_001_720p.mp4
                ├── aula_001_480p.mp4
                ├── aula_002_1080p.mp4
                └── ...
```

### 11.2 Configuração Nginx (Abordagem B – Servir Temp)

```nginx
server {
    listen 80;
    server_name recordings.example.com;
    root /var/www/recordings;

    location / {
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options "nosniff";
        add_header Access-Control-Allow-Origin "*";
    }

    location ~ \.mp4$ {
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=3600";
    }
}
```

### 11.3 Sinal de Fim de Live

**Recomendado:** O operador de câmera (ou quem transmite) clica em um botão **"Aula acabou"** no painel da live. O frontend chama uma API (ex.: `POST /api/recordings/lesson-boundary` ou `POST /live/ended`) que dispara o processamento. Todas as abordagens (A, B, C) dependem desse sinal.

**Opção 1: Arquivo marker**
```bash
# Ao final da live, criar arquivo
touch /recordings/live_1080p/END
# Script de concat verifica existência de END
```

**Opção 2: Webhook/API**
```bash
# FFmpeg ou NGINX-RTMP chama webhook ao final
curl -X POST https://api.example.com/live/ended -d '{"stream_id":"aula_123"}'
```

**Opção 3: Polling**
```bash
# Script verifica se não há novos .ts há 30 segundos
while true; do
  if [[ $(find /recordings -name "*.ts" -mmin -0.5 | wc -l) -eq 0 ]]; then
    # Live terminou
    break
  fi
  sleep 10
done
```

### 11.4 Ordenação de Segmentos

```bash
# HLS típico: seg0.ts, seg1.ts, ... seg336.ts
# Ordenação numérica correta:
ls -1v seg*.mp4  # GNU ls
# Ou:
ls -1 seg*.mp4 | sort -V
# Ou (portável):
ls -1 seg*.mp4 | sort -t'e' -k2 -n
```

### 11.5 Configuração rclone para R2

```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = <R2_ACCESS_KEY>
secret_access_key = <R2_SECRET_KEY>
endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
```

### 11.6 Lesson Boundaries (Stream Contínuo com Múltiplas Aulas)

Quando o stream contém **6 aulas em sequência** (ex.: 7:10–12:20), é necessário marcar o fim de cada aula para que o pós-processamento possa separar os vídeos por aula.

#### O que será feito

| Item | Descrição |
|------|-----------|
| **Objetivo** | Marcar o fim de cada aula em um stream contínuo para gerar MP4s separados por aula. |
| **Problema** | O merge atual concatena todos os `.ts` em um único MP4. Com 6 aulas em sequência, precisa-se saber onde termina cada aula. |
| **Solução** | API que registra o fim de cada aula em tempo real; o script de merge usa esses registros para cortar o stream em segmentos por aula. |

#### Como funciona

**Fluxo:**
```
[Durante o stream] Aula N termina → POST /api/recordings/lesson-boundary { lessonIndex: N }
[Após o stream]   Script de merge → GET /api/recordings/lesson-boundaries → mapeia boundaries aos .ts → gera N MP4s
```

**Rotas:**

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/recordings/lesson-boundary` | Registra o fim de uma aula |
| GET | `/api/recordings/lesson-boundaries?streamName=&session=` | Lista os boundaries de um stream |

**Body do POST:**
```json
{
  "streamName": "posilive_main",
  "session": "2025-03-09",
  "lessonIndex": 2,
  "timestamp": "2025-03-09T09:45:00Z"
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `streamName` | sim | Nome do stream |
| `session` | sim | Identificador da sessão |
| `lessonIndex` | sim | Índice da aula (0 a 5 para 6 aulas) |
| `timestamp` | não | ISO 8601 do fim da aula (default: now) |

**Armazenamento:** `{RECORDINGS_DIR}/boundaries/{streamName}_{session}.json` (ex.: `/recordings/boundaries/posilive_main_2025-03-09.json`)

**Formato do arquivo:**
```json
{
  "streamName": "posilive_main",
  "session": "2025-03-09",
  "boundaries": [
    { "lessonIndex": 0, "timestamp": "...", "recordedAt": "..." },
    { "lessonIndex": 1, "timestamp": "...", "recordedAt": "..." }
  ]
}
```

#### Quando

| Momento | Ação |
|---------|------|
| Durante a live | Posiplay/LMS ou painel do professor chama POST ao encerrar cada aula |
| Após a live | Script de merge chama GET antes de processar |
| Frequência | 6 POSTs por stream (uma vez por aula) |

#### Onde

| Componente | Local |
|------------|-------|
| API | `server/api/server.js` (Express LiveBridge) |
| Arquivos | Disco local da VM em `RECORDINGS_DIR/boundaries/` |
| Integração | Posiplay/LMS ou painel do professor |
| Uso no merge | `server/merge/server.js` lê boundaries antes do concat |

#### Custo

| Recurso | Uso | Custo |
|---------|-----|-------|
| Storage | ~1–5 KB por stream | Desprezível |
| CPU | Leitura/escrita JSON | Desprezível |
| Rede | 6 POSTs + 1 GET por stream | Desprezível |
| R2 / APIs / DB | Não usa | US$ 0 |

**Impacto em custo: nenhum.** A rota grava apenas JSON em disco; o volume é desprezível em relação ao custo de vídeo (~7 TB/ano).

#### Outras informações

- **Autenticação:** Proteger a rota (token interno, JWT ou API key).
- **Uso no merge:** Mapear cada boundary aos segmentos `.ts` via `mtime`; gerar um MP4 por aula.
- **Retrocompatibilidade:** Se não houver boundaries, o merge continua gerando um único MP4 (comportamento atual).

### 11.7 Live com 3 Resoluções (Transcodificação 1→3)

O OBS envia **apenas 1 stream** (ex.: 1080p ou 720p). As 3 resoluções (1080p, 720p, 480p) são geradas no **servidor** por transcodificação em tempo real.

#### Fluxo geral

```
OBS (1 stream, ex: 1080p)
        │
        │ RTMP
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Servidor                                                      │
│                                                                │
│  RTMP Ingest ──► FFmpeg (transcode em tempo real)             │
│                        │                                       │
│                        ├──► 1080p HLS (passthrough ou scale)   │
│                        ├──► 720p HLS  (scale 1280x720)         │
│                        └──► 480p HLS  (scale 854x480)          │
└───────────────────────────────────────────────────────────────┘
```

#### Opções de implementação

**Opção 1: FFmpeg lendo do RTMP**

O servidor RTMP (MediaMTX, nginx-rtmp, SRS) recebe o stream do OBS. O FFmpeg **puxa** esse stream e gera as 3 resoluções:

```bash
ffmpeg -i rtmp://localhost/live/matematica \
  -filter_complex "[0:v]split=3[v1][v2][v3]; \
    [v1]scale=1920:1080[v1s]; [v2]scale=1280:720[v2s]; [v3]scale=854:480[v3s]" \
  -map "[v1s]" -map 0:a -c:v:0 libx264 -b:v:0 5000k -c:a aac -f hls -hls_time 6 -hls_playlist_type event \
    -hls_segment_filename "/recordings/live_1080p/seg%03d.ts" /recordings/live_1080p/index.m3u8 \
  -map "[v2s]" -map 0:a -c:v:1 libx264 -b:v:1 2500k -c:a aac -f hls -hls_time 6 -hls_playlist_type event \
    -hls_segment_filename "/recordings/live_720p/seg%03d.ts" /recordings/live_720p/index.m3u8 \
  -map "[v3s]" -map 0:a -c:v:2 libx264 -b:v:2 1000k -c:a aac -f hls -hls_time 6 -hls_playlist_type event \
    -hls_segment_filename "/recordings/live_480p/seg%03d.ts" /recordings/live_480p/index.m3u8
```

**Opção 2: nginx-rtmp com `exec`**

O nginx-rtmp recebe o stream e, ao detectar publicação, dispara o FFmpeg:

```nginx
application live {
    live on;
    exec ffmpeg -i rtmp://localhost/live/$name
      -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080[v1s];[v2]scale=1280:720[v2s];[v3]scale=854:480[v3s]"
      -map "[v1s]" -map 0:a ... 3 outputs HLS ...;
}
```

**Opção 3: MediaMTX + FFmpeg em paralelo**

O MediaMTX não transcodifica. Para ter 3 resoluções seria preciso um processo FFmpeg que leia o stream (por exemplo via HLS do MediaMTX ou via relay RTMP) e gere as 3 saídas HLS.

**Opção 4: SRS (Simple Realtime Server)**

O SRS tem suporte nativo a transcodificação e pode ser configurado para gerar múltiplas variantes HLS automaticamente.

#### Impacto em delay

| Cenário | Delay aproximado |
|---------|------------------|
| **Sem transcodificação** (OBS → MediaMTX → HLS) | ~8–15 s |
| **Com transcodificação** (OBS → FFmpeg → 3× HLS) | ~12–25 s |

**Fatores que adicionam delay:**

| Fator | Efeito |
|-------|--------|
| Decode + encode | FFmpeg precisa decodificar, redimensionar e codificar cada quadro |
| Buffer do FFmpeg | Geralmente 1–2 segmentos em memória |
| Lookahead (NVENC) | Melhora qualidade, mas adiciona ~0,5–1 s |
| Segmentos HLS | 6 s por segmento ≈ 6 s de delay mínimo |

#### Como reduzir o delay

| Ação | Efeito |
|------|--------|
| **Segmentos menores** | 2–4 s em vez de 6 s → menos delay, mais overhead |
| **GPU (NVENC)** | Encode mais rápido → menos delay que libx264 |
| **Preset mais rápido** | `veryfast` em vez de `slow` → menos delay |
| **Desativar lookahead** | Menos delay, qualidade um pouco menor |

**Transcodificação adiciona ~3–10 s ao delay.** Com GPU, o impacto costuma ser menor (~2–5 s). Para aulas ao vivo, 15–25 s é aceitável.

#### Custo de recursos

| Método | CPU | GPU |
|--------|-----|-----|
| **libx264** | ~4–8 vCPU para 3 resoluções em tempo real | Não |
| **NVENC (hevc_nvenc)** | Baixo | T4 ou similar |

#### Resumo

| Item | Recomendação |
|------|--------------|
| **OBS** | Enviar 1 stream em 1080p (ou 720p) via RTMP |
| **Servidor** | RTMP (MediaMTX, nginx-rtmp ou SRS) |
| **Transcode** | FFmpeg lê do RTMP e gera 3 HLS em tempo real |
| **Delay** | +3–10 s vs sem transcodificação |
| **Recursos** | GPU T4 (NVENC) ou 4–8 vCPU (libx264) |

---

## 12. Monitoramento e Troubleshooting

### 12.1 Métricas a Monitorar

| Métrica | Abordagem A | Abordagem B | Abordagem C |
|---------|-------------|-------------|
| Segmentos comprimidos/min | ~7–8 | — | — |
| Tempo de concat | < 2 min | < 3 min | < 3 min |
| Tempo de upload | < 5 min | < 5 min | < 7 min |
| Egress GCP | 0 | Por view | 0 |
| Uso GPU | 60–80% | — | — |
| Uso CPU | 30–50% | 90–100% durante encode | 90–100% durante encode |

### 12.2 Problemas Comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Concat falha | Segmentos fora de ordem | Ordenar com `sort -V` |
| NVENC não encontrado | GPU não disponível | Verificar driver, usar T4 |
| Egress alto (B) | Muitas views no temp | Considerar CDN ou abordagem A/C |
| Disco cheio | Segmentos não apagados | Limpeza após upload |

### 12.3 Checklist de Implementação

**Abordagem A:**
- [ ] VM com GPU T4 provisionada
- [ ] Driver NVIDIA instalado
- [ ] inotify-tools instalado
- [ ] Script watcher rodando em systemd/supervisor
- [ ] Script concat + upload com permissões
- [ ] rclone configurado para R2
- [ ] Sinal de fim de live implementado

**Abordagem B:**
- [ ] VM com 16 vCPU provisionada
- [ ] Nginx configurado para servir /recordings
- [ ] Script concat + encode + upload
- [ ] API para atualizar URL (VM → R2)
- [ ] rclone configurado para R2
- [ ] Sinal de fim de live implementado

**Abordagem C:**
- [ ] VM com 16 vCPU provisionada
- [ ] MediaMTX ou Nginx serve .ts como HLS (vídeo disponível imediatamente)
- [ ] Script concat + encode slow + upload para R2 em background
- [ ] API para atualizar URL (VM → R2) quando comprimido sobe
- [ ] rclone configurado para R2
- [ ] Sinal de fim de live implementado

---

## 13. Resumo Executivo

| | Abordagem A | Abordagem B | Abordagem C |
|---|-------------|-------------|-------------|
| **Disponível em** | 3–6 min | ~5 min | Imediato |
| **Versão final** | 3–6 min | ~2 h | ~2 h |
| **Tamanho** | ~5–15% maior | Menor | Menor |
| **GPU** | Obrigatória | Não | Não |
| **Custo base** | ~US$ 390/mês | ~US$ 385/mês | ~US$ 383/mês |
| **Custo extra** | — | Egress GCP (variável) | Egress GCP (variável, menor que B) |
| **Recomendação** | Muitas views, sem egress | Poucas views, máxima compressão | **Mais barata e viável** |

---

*Documento gerado para o projeto PosiLive/LiveBridge*
