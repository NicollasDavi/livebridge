# PosiLive – Arquitetura de Streaming e Gravação

**Documento técnico completo**  
*Sistema de streaming ao vivo com gravação, transcodificação em 3 qualidades, compressão e armazenamento em nuvem*

---

## 1. Visão Geral

Sistema de streaming ao vivo com gravação, transcodificação em 3 qualidades (1080p, 720p, 480p), compressão e armazenamento em nuvem, com vídeos disponíveis em até 15 minutos após o fim da transmissão.

---

## 2. O Que Será Feito

| Etapa | Descrição |
|-------|-----------|
| **Ingest** | Receber sinal RTMP da live |
| **Transcode em tempo real** | Gerar HLS em 3 resoluções (1080p, 720p, 480p) |
| **Gravação** | Salvar segmentos .ts em disco |
| **Compressão** | Converter .ts em MP4 comprimido (H.264 ou H.265) |
| **Armazenamento** | Enviar MP4s para Cloudflare R2 |
| **Entrega** | Streaming via CDN Cloudflare |

---

## 3. Fluxo Técnico

### 3.1 Durante a Live (45–50 min)

```
Encoder (OBS/Streamer)
        │
        │ RTMP
        ▼
┌─────────────────────────────────────────────────────────┐
│  VM GCP (México ou Chile)                               │
│                                                         │
│  ┌─────────────┐    ┌─────────────────────────────────┐ │
│  │  NGINX-RTMP │───►│  FFmpeg (transcode em tempo real)│ │
│  │  (ingest)   │    │  • 1080p HLS                     │ │
│  └─────────────┘    │  • 720p HLS                      │ │
│                     │  • 480p HLS                      │ │
│                     └────────────┬────────────────────┘ │
│                                  │                      │
│                     Segmentos .ts (6–10 seg cada)       │
│                                  │                      │
│                     ┌────────────▼────────────────────┐ │
│                     │  Disco local (/recordings)      │ │
│                     │  • live_1080p/seg0.ts, seg1.ts.. │ │
│                     │  • live_720p/seg0.ts, seg1.ts.. │ │
│                     │  • live_480p/seg0.ts, seg1.ts.. │ │
│                     └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Pós-Processamento (após o fim da live)

**Opção A – Compressão em lote**

- Concat .ts → input temporário
- 3 transcodes em paralelo (GPU NVENC): 1080p, 720p, 480p → H.265
- Tempo: ~6–10 min
- Upload 3 MP4s para R2: ~2–3 min
- **Total: ~10–13 min**

**Opção B – Compressão por segmento**

- Durante a live: cada .ts criado → comprime imediatamente → segment_N.mp4
- Ao final: concat (copy) de todos os .mp4 → vídeo final
- Upload para R2
- **Total pós-live: ~3–5 min**

### 3.3 Entrega ao Usuário

```
R2 (Cloudflare) → CDN (domínio customizado) → Cloudflare Edge (PoP SP) → Alunos
```

---

## 4. Infraestrutura

| Componente | Onde | Especificação |
|------------|------|---------------|
| **Compute** | GCP México ou Chile | VM n1-standard-8 + GPU T4 |
| **Disco** | VM local | 100–200 GB SSD |
| **Storage** | Cloudflare R2 | ~7 TB/ano |
| **CDN** | Cloudflare | Plano Free |

### Regiões

| Região | Latência Brasil | Custo VM |
|--------|-----------------|----------|
| São Paulo | ~5–20 ms | Mais caro |
| Santiago | ~50 ms | Médio |
| México | ~100–130 ms | Mais barato |

---

## 5. Tempos

| Etapa | Duração |
|-------|---------|
| Live | 45–50 min |
| Concat .ts | ~1–2 min |
| Compressão (3 qualidades, GPU) | ~6–10 min |
| Upload R2 | ~2–3 min |
| **Total (live → disponível)** | **~10–15 min** |

---

## 6. Custos Mensais (estimativa)

| Item | Especificação | Custo (USD) |
|------|---------------|-------------|
| VM GCP | n1-standard-8 + T4, México | ~US$ 280 |
| Disco | 100 GB | ~US$ 5 |
| R2 Storage | 7 TB | ~US$ 105 |
| CDN | Cloudflare Free | US$ 0 |
| Egress | R2 | US$ 0 |
| **Total** | | **~US$ 390/mês** |

---

## 7. Comparação com Alternativas

| Cenário | Custo mensal |
|---------|--------------|
| **Esta arquitetura** (GCP + R2) | ~US$ 390 |
| GCP completo (SP + GCS + egress) | ~US$ 1.200+ |
| AWS (SP + S3 + egress) | ~US$ 1.400+ |
| **Economia estimada** | **~US$ 800–1.000/mês** |

---

## 8. Vantagens

- **Egress grátis** no R2
- **CDN ilimitada** (Cloudflare Free)
- **Latência aceitável** (Chile/México)
- **Vídeo em 10–15 min** após a live
- **Compressão H.265** para menor tamanho
- **3 qualidades** para adaptação
- **Custo reduzido** vs AWS/GCP tradicional

---

## 9. Desvantagens e Riscos

- **Latência** maior que São Paulo (~100 ms no México)
- **GPU** pode não estar em todas as regiões
- **H.265** com suporte limitado em alguns navegadores
- **Complexidade** do pipeline
- **Câmbio** (USD) afeta custo em R$

---

## 10. Economia de Storage (Compressão)

| Codec | Tamanho 45 min 1080p | vs original |
|-------|----------------------|-------------|
| Copy (.ts) | ~4–5 GB | — |
| H.264 CRF 23 | ~1,5 GB | ~70% menor |
| H.265 CQ 23 | ~1,0 GB | ~80% menor |

---

## 11. Resumo Executivo

| Item | Resposta |
|------|----------|
| **O quê** | Live + gravação + 3 qualidades + compressão + R2 |
| **Como** | FFmpeg RTMP→HLS, NVENC/hevc_nvenc, rclone para R2 |
| **Onde** | GCP (México ou Chile) + Cloudflare R2 + CDN |
| **Quanto** | ~US$ 390/mês |
| **Tempo** | ~10–15 min após live |
| **Economia** | ~US$ 800–1.000/mês vs AWS/GCP padrão |

---

*Documento gerado para o projeto PosiLive/LiveBridge*
