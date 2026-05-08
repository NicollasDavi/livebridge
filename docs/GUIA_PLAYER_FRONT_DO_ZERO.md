# Guia Completo: Player Front do Zero (LiveBridge)

Este guia descreve a forma mais robusta de construir um player web do zero para consumir o LiveBridge, com foco em:

- playback ao vivo (ABR HLS),
- playback de gravações (R2 e/ou parcial local),
- acompanhamento de processamento de aula,
- estabilidade e boa experiência do usuário.

Sem mudar contrato de API: tudo aqui usa as rotas existentes.

---

## 1) Arquitetura recomendada

Para frontend em produção, o melhor padrão e:

- Frontend chama sua API/BFF (Java) como origem unica.
- A API/BFF faz proxy para o LiveBridge em `/api/*` e `/api/hls/*` quando necessario.
- O browser nunca precisa falar com portas internas do Docker.

Resultado:

- menos problemas de CORS,
- cookies e token em um dominio so,
- observabilidade centralizada no BFF.

---

## 2) Bibliotecas recomendadas no front

- HLS no browser: `hls.js` (MSE).
- Fallback Safari/iOS: usar `<video src="...m3u8">` nativo quando `Hls.isSupported()` for falso.
- Estado de player: store simples (Redux/Zustand/Context) para persistir status da live e erro de playback.

---

## 3) Fluxo ideal para LIVE (ordem exata)

### 3.1 Inicializacao da sessao do player

Se sua camada Java ja cuida de cookie/token de live, siga com ela.
Se o front fala direto com LiveBridge, use:

1. `POST /api/init-live` com `streamName` e `token` (JWT live), ou
2. `GET /api/init` no modo legado.

### 3.2 Descobrir lives ativas

- Chame `GET /api/live/transmissoes`
- Use `items[]` para renderizar lista de aulas ao vivo.

### 3.3 Montar URL de playback

Para cada stream selecionada:

- URL master: `GET /api/live/hls-master.m3u8?streamName=<nome>`
- Essa rota devolve master ABR com 1080/720/480.

### 3.4 Iniciar player

Recomendacao:

- Tentar com `hls.js`.
- Se `hls.js` nao suportado, usar `<video>` nativo.
- Em `503` no manifest, retry com backoff curto (2s, 3s, 5s, max 10s).

Exemplo minimo (React/TS):

```ts
import Hls from 'hls.js';

export function attachLive(video: HTMLVideoElement, masterUrl: string) {
  if (Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: false,
      backBufferLength: 90
    });
    hls.loadSource(masterUrl);
    hls.attachMedia(video);
    return () => hls.destroy();
  }
  video.src = masterUrl;
  return () => {};
}
```

---

## 4) Fluxo ideal para GRAVACOES

## 4.1 Catalogo principal

- `GET /api/recordings`
- Para acervo grande, usar paginacao:
  - `GET /api/recordings?paginate=1&maxKeys=500&cursor=...`

## 4.2 URL de playback por item

Use sempre:

- `GET /api/recordings/video?path=<path>&session=<session>`

Por que:

- se ainda existir TS parcial local, a API redireciona para HLS de forma transparente;
- se ja estiver no R2, a API entrega MP4 (inclusive range requests).

Ou seja, o front usa uma rota unica para VOD.

## 4.3 Qualidade manual (opcional)

Quando quiser forcar variante MP4:

- `GET /api/recordings/video?...&variant=1080|720|480`

---

## 5) Aulas finalizadas em processamento (UX forte)

Para mostrar "processando video" sem confundir usuario:

1. Chamar `GET /api/recordings/pending`
2. Para cada item em `processing`, consultar:
   - `GET /api/recordings/status?path=<...>&session=<...>`
   - ou `GET /api/recordings/merge-progress?path=<...>&session=<...>`
3. Atualizar card em tempo real (polling de 3 a 5s).

Estados recomendados de UI:

- `processing`: "Processando e enviando..."
- `ready`: habilita botao "Assistir"
- `failed`: oferecer "Tentar novamente mais tarde" e logar observabilidade.

---

## 6) Componente de player (modelo recomendado)

Crie um componente unico `VideoPlayer` com dois modos:

- `mode="live"` -> usa `/api/live/hls-master.m3u8`
- `mode="recording"` -> usa `/api/recordings/video`

API interna do componente:

- `sourceType: 'live' | 'recording'`
- `streamName?`
- `path?`
- `session?`
- `autoplay?`
- `muted?`
- callbacks: `onReady`, `onError`, `onRetry`, `onQualityChanged`

Assim voce evita duplicar logica de retry, fallback e tratamento de erros.

---

## 7) Politica de retry e resiliencia no front

Padrao recomendado:

- Erro de manifest live (`503`, `404` transitorio): retry automatico.
- Erro de rede (`networkError` no hls.js): retry automatico com backoff.
- Erro fatal de media (`mediaError`): `hls.recoverMediaError()` uma vez; se falhar, recriar instancia.
- Timeout total de entrada em live: 30s com mensagem amigavel.

Backoff sugerido:

- tentativas: 2s, 3s, 5s, 8s, 10s (cap em 10s),
- resetar backoff quando houver playback estavel por 30s.

---

## 8) Qualidade e performance no player

Configuracoes uteis de player:

- iniciar em qualidade automatica (ABR),
- permitir troca manual (opcional),
- limitar buffer para evitar consumo excessivo de memoria em abas longas,
- pausar polling de status quando aba em background (Page Visibility API),
- destruir instancia `hls` ao desmontar componente para evitar leak.

Para listas grandes de aulas:

- paginação/infinite scroll no catalogo,
- nao renderizar dezenas de `<video>` ao mesmo tempo,
- usar lazy-load de metadados/pôster.

---

## 9) Contratos e respostas (resumo pratico)

Live:

- `GET /api/live/transmissoes` -> `{ items: [...] }`
- `GET /api/live/hls-master.m3u8?streamName=...` -> `application/vnd.apple.mpegurl`

Gravacoes:

- `GET /api/recordings` -> array (ou objeto paginado quando `paginate=1`)
- `GET /api/recordings/video?...` -> redirect para HLS parcial ou stream MP4
- `GET /api/recordings/pending` -> lista de processamentos
- `GET /api/recordings/status?...` e `/api/recordings/merge-progress?...` -> estado/progresso

---

## 10) Checklist de implementacao (ordem recomendada)

1. Criar wrapper HTTP do BFF (com `credentials: 'include'`).
2. Implementar lista de lives (`/api/live/transmissoes`).
3. Implementar `LivePlayer` com `/api/live/hls-master.m3u8`.
4. Implementar catalogo de gravacoes (`/api/recordings`, com paginacao).
5. Implementar `RecordingPlayer` usando apenas `/api/recordings/video`.
6. Implementar tela de "aulas em processamento" (`pending` + `status`/`merge-progress`).
7. Adicionar telemetria de erro de playback (Sentry/Datadog/etc).
8. Rodar testes em Chrome, Edge, Safari iOS e Android.

---

## 11) Erros comuns e como evitar

- Montar URL direto para segmento `.ts` no front:
  - Evite. Use master/playlist oficial da API.
- Nao enviar cookies/credenciais:
  - Configure `credentials: 'include'` em chamadas HTTP.
- Tentar tratar live e VOD com dois players totalmente separados:
  - Centralize em um modulo unico de playback para reduzir bugs.
- Nao tratar `503` de live como transitorio:
  - Sempre faça retry com backoff.

---

## 12) Exemplo de fluxo completo (usuario final)

1. Usuario abre "Ao vivo".
2. Front busca `/api/live/transmissoes`.
3. Usuario clica numa aula.
4. Front carrega `/api/live/hls-master.m3u8?streamName=...`.
5. Player inicia em ABR automatico.
6. Aula termina; item aparece em `/api/recordings/pending`.
7. Quando status vira `ready`, aula entra no catalogo de `/api/recordings`.
8. Usuario abre gravação via `/api/recordings/video?...`.

Esse fluxo usa todas as capacidades atuais do LiveBridge sem acoplamento fragil no frontend.

