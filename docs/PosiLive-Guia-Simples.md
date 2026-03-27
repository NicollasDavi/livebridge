# PosiLive — Guia Simples para Decisores

**Versão para quem não é técnico**  
*O que será feito, prós e contras, tempo e custo*

---

## 1. O que é o PosiLive?

O PosiLive transmite aulas ao vivo pela internet. O professor grava a aula no computador dele e envia para um servidor. Os alunos assistem em tempo real e, depois, podem rever a gravação.

**O que precisamos decidir:** como transformar a transmissão ao vivo em vídeos gravados que ficam disponíveis para os alunos assistirem quando quiserem.

---

## 2. O que será feito (resumo)

| Etapa | O que acontece |
|-------|----------------|
| **1. Transmissão** | O professor transmite a aula pelo computador. O sinal vai para um servidor na nuvem. |
| **2. Gravação** | O servidor grava a aula em pedaços pequenos (como capítulos de um livro). |
| **3. Montagem** | Depois que a aula termina, o servidor junta os pedaços em um vídeo completo. |
| **4. Compactação** | O vídeo é compactado para ocupar menos espaço e carregar mais rápido. |
| **5. Armazenamento** | O vídeo final é guardado em um serviço de armazenamento na nuvem. |
| **6. Entrega** | Os alunos assistem o vídeo pela internet, em qualquer horário. |

A dúvida é: **em que momento** compactar o vídeo e **onde** guardar enquanto isso acontece. Existem três formas de fazer isso.

**Importante:** Em todas as opções, **durante a live**, o operador de câmera (ou quem transmite) precisa clicar em um botão para indicar que a aula acabou. Sem esse sinal, o servidor não sabe quando parar de gravar e quando iniciar o processamento.

---

## 3. As três opções explicadas

### Opção A — Compactar durante a aula

**O que acontece:**  
Enquanto o professor transmite, o servidor já vai compactando cada pedaço da aula. Quando a aula termina, o servidor só junta tudo e envia para o armazenamento. O vídeo fica pronto em poucos minutos.

**Prós:**
- Vídeo disponível muito rápido (3 a 6 minutos após o fim da aula)
- Não gera custo extra de internet para transmitir o vídeo
- Tudo fica guardado em um único lugar desde o início

**Contras:**
- Precisa de um equipamento especial (placa de vídeo dedicada) no servidor
- O vídeo compactado fica um pouco maior (~5 a 15%) que nas outras opções
- A implementação é mais trabalhosa

**Tempo:** 3 a 6 minutos para o vídeo ficar pronto  
**Custo mensal:** cerca de **US$ 390** (R$ ~2.000, variando com o câmbio)

**Ações necessárias durante a live:**  
O operador de câmera (ou quem transmite) deve **clicar em um botão** para indicar que a aula acabou. Esse sinal avisa o servidor para juntar os pedaços e enviar para o armazenamento.

---

### Opção B — Servir da máquina e compactar em paralelo

**O que acontece:**  
Quando a aula termina, o servidor junta os pedaços em um vídeo “bruto” (sem compactar) e o disponibiliza na hora. Os alunos já podem assistir. Em paralelo, o servidor compacta o vídeo e, quando termina (~2 horas), troca o vídeo bruto pelo compactado no armazenamento final.

**Prós:**
- Vídeo disponível em cerca de 5 minutos
- Compactação de melhor qualidade (arquivo menor)
- Não precisa de placa de vídeo especial

**Contras:**
- Nos primeiros ~2 horas, os alunos assistem o vídeo “bruto” direto do servidor, o que gera custo de internet (quanto mais pessoas assistindo, maior o custo)
- O endereço do vídeo muda quando a versão compactada fica pronta
- Se muitas pessoas assistirem logo após a aula, o custo pode subir bastante

**Tempo:** ~5 minutos para ficar disponível; ~2 horas para a versão final  
**Custo mensal:** de **US$ 385** a **US$ 1.800+**, dependendo de quantas pessoas assistem logo após a aula

**Ações necessárias durante a live:**  
O operador de câmera (ou quem transmite) deve **clicar em um botão** para indicar que a aula acabou. Esse sinal avisa o servidor para juntar os pedaços e iniciar a compactação em paralelo.

---

### Opção C — Servir os pedaços direto da máquina e compactar em paralelo *(mais barata e viável)*

**O que acontece:**  
Quando a aula termina, os pedaços da gravação já estão no servidor. O servidor disponibiliza esses pedaços para os alunos assistirem na hora (sem precisar juntar tudo antes). Em paralelo, o servidor junta os pedaços, compacta o vídeo e envia para o armazenamento. Quando termina (~2 horas), o sistema passa a usar a versão compactada.

**Prós:**
- Vídeo disponível imediatamente
- A mais barata e viável das três opções
- Menos etapas = menos coisa para dar errado
- Compactação de boa qualidade (arquivo menor)
- Não precisa de placa de vídeo especial

**Contras:**
- Nos primeiros ~2 horas, os alunos assistem direto do servidor (custo de internet, mas menor que a Opção B)
- O endereço do vídeo muda quando a versão compactada fica pronta

**Tempo:** Disponível imediatamente; ~2 horas para a versão final  
**Custo mensal:** de **US$ 350 a 380** (base) até mais se muitos assistirem logo após a aula

**Ações necessárias durante a live:**  
O operador de câmera (ou quem transmite) deve **clicar em um botão** para indicar que a aula acabou. Esse sinal avisa o servidor de que a gravação terminou: os pedaços passam a ser disponibilizados imediatamente para os alunos, e o processo de compactação e envio para o armazenamento é iniciado em paralelo.

---

## 4. Comparativo lado a lado

| Pergunta | Opção A | Opção B | Opção C |
|----------|---------|---------|---------|
| **Em quanto tempo o vídeo fica disponível?** | 3 a 6 min | ~5 min | Imediato |
| **Em quanto tempo a versão final fica pronta?** | 3 a 6 min | ~2 h | ~2 h |
| **Precisa de equipamento especial?** | Sim (placa de vídeo) | Não | Não |
| **O custo aumenta se muitos assistirem logo após a aula?** | Não | Sim | Sim |
| **Custo mensal (base)** | ~US$ 390 | ~US$ 385 | ~US$ 350–380 |
| **Custo pode subir muito?** | Não | Sim (até US$ 1.800+) | Sim (menos que B) |
| **Mais barata e viável?** | Não | Não | **Sim** |
| **Ação durante a live** | Operador clica em "Aula acabou" | Operador clica em "Aula acabou" | Operador clica em "Aula acabou" |

---

## 5. Qual opção escolher?

| Situação | Recomendação |
|----------|--------------|
| Quer a opção mais barata e viável | **Opção C** |
| Quer o vídeo disponível imediatamente | **Opção C** |
| Quer o vídeo compactado pronto o mais rápido possível | **Opção A** (3 a 6 min) |
| Muitos alunos assistem logo após a aula | **Opção A** (evita custo extra de internet) |
| Poucos alunos assistem logo após a aula | **Opção B** ou **Opção C** |
| Não quer depender de equipamento especial | **Opção B** ou **Opção C** |
| Quer previsibilidade de custo | **Opção A** |

---

## 6. Custos em resumo

| Item | Valor aproximado |
|------|------------------|
| **Servidor na nuvem** | ~US$ 280/mês |
| **Armazenamento de vídeos** | ~US$ 95 a 110/mês |
| **Outros (disco, etc.)** | ~US$ 5 a 10/mês |
| **Total (Opção A)** | **~US$ 390/mês** |
| **Total (Opção B ou C, poucos acessos)** | **~US$ 350 a 385/mês** |
| **Total (Opção B ou C, muitos acessos)** | **Pode passar de US$ 1.000/mês** |

*Valores em dólar. Em reais, multiplique pelo câmbio atual (ex.: R$ 5,00 ≈ R$ 1.950 a 2.000/mês).*

---

## 7. Sobre as 3 qualidades de vídeo (HD, médio, baixo)

O professor transmite em **uma** qualidade (ex.: HD). O servidor pode gerar **três** versões do mesmo vídeo:

- **Alta** (1080p) — para quem tem internet boa  
- **Média** (720p) — equilíbrio  
- **Baixa** (480p) — para internet lenta  

Isso exige que o servidor processe o vídeo em tempo real. **Consequências:**

- Adiciona cerca de **3 a 10 segundos** de atraso na transmissão ao vivo  
- Para aulas, esse atraso costuma ser aceitável  

---

## 8. Resumo em uma frase

- **Opção A:** Vídeo compactado pronto em minutos, custo fixo, precisa de placa de vídeo.  
- **Opção B:** Junta os pedaços em 5 min, depois compacta; custo variável.  
- **Opção C:** Vídeo disponível imediatamente (servir os pedaços direto), compacta em paralelo — **a mais barata e viável**.

---

*Documento criado para o projeto PosiLive/LiveBridge*
