# SwarmBuild — Apresentação do Projeto

> Documento de apresentação para validação da proposta de arquitetura.
> Global Solution / FIAP · 2026

---

## 1. Identificação do projeto

**Nome do projeto:** **SwarmBuild** — Orquestração de Enxame para Construção Autônoma em Ambientes Hostis e de Alta Latência.

**Cenário do MVP:** robôs (rovers) constroem a cúpula de um habitat lunar **antes** da chegada dos humanos, e o canteiro de obras **se reorganiza sozinho quando um rover falha — sem operador no loop de controle.**

**Pitch em uma frase:** mate um rover no meio da construção de uma parede, veja a tarefa dele ser re-leiloada e outro rover terminar a parede; a cúpula ainda fecha — tudo em ~30 segundos, sem nenhuma intervenção da Terra.

### 1.1. Composição da equipe

| Nome | RM |
|---|---|
| _(a preencher)_ | _RM00000_ |
| _(a preencher)_ | _RM00000_ |
| _(a preencher)_ | _RM00000_ |
| _(a preencher)_ | _RM00000_ |
| _(a preencher)_ | _RM00000_ |

> **Pendente:** preencher com os nomes e RMs dos integrantes antes da entrega.

---

## 2. O desafio / problema escolhido (10 pts)

### 2.1. Contexto

A base Artemis precisa ser construída por robôs operários **antes** de os humanos chegarem à Lua. O ambiente é hostil: poeira lunar (regolito) altamente abrasiva e terreno irregular. Nessas condições os robôs **vão falhar e quebrar** — não é exceção, é o comportamento esperado.

### 2.2. O problema central — latência

O obstáculo de fundo é a **latência Terra–Lua de ~2,6 segundos ida-e-volta** (e mais ainda quando há relay de sinal). Isso torna **impossível** colocar um operador na Terra no loop de controle tático:

- Se a escavadeira A pifa dentro de uma cratera, ninguém na Terra reage a tempo de realocar a escavadeira B.
- Programar cada robô individualmente também **não escala e não tolera falha**: quando um robô morre, a obra para naquele ponto e fica presa.

O problema a resolver, portanto, é: **como fazer um canteiro de obras se reorganizar sozinho diante de falhas de equipamento, sem depender de comando remoto, mantendo todos os robôs com uma visão coerente do estado da construção mesmo quando perdem comunicação entre si.**

### 2.3. A solução proposta

Uma plataforma de software de **controle de enxame** (swarm intelligence). Em vez de programar robôs um a um, o operador define um **blueprint de construção de alto nível** e o sistema:

- **Decompõe** o blueprint em tarefas atômicas respeitando dependências (não assenta parede sem fundação) — *Task Planner (DAG)*.
- **Aloca** tarefas por **leilão** (Contract Net Protocol): cada robô dá um lance baseado em distância, bateria e capacidade; o de menor custo ganha — *Allocation Engine*.
- **Concede** a tarefa como um **lease com TTL**, renovado por **heartbeat**; o silêncio detecta a falha — *Lease Manager*.
- **Re-leiloa automaticamente** a tarefa do robô que pifou para outro robô — sem intervenção da Terra. Essa **autocura** emerge da composição *expiração de lease + re-leilão*, sem nenhuma lógica de supervisão especial.
- Mantém um **estado global compartilhado** (World Model) tolerante a partição de rede, com reconciliação livre de conflito (CRDT).

A decisão tática vive na **borda** (um lander no próprio canteiro); a Terra só define metas e recebe telemetria por um canal assíncrono de alta latência — deliberadamente fora do loop tático.

> Arquitetura completa em [C4-ptbr.md](./C4-ptbr.md) · linguagem de domínio em [CONTEXT.md](../CONTEXT.md) · requisitos em [PRD-SwarmBuild-MVP.md](./mvp/PRD-SwarmBuild-MVP.md).

### 2.4. Por que a arquitetura resolve o problema

| Restrição do problema | Decisão arquitetural |
|---|---|
| Latência impede comando remoto | Autonomia **na borda**; a Terra é assíncrona e fora do loop tático |
| Robôs falham como regra, não exceção | **Autocura** = lease com TTL + heartbeat + re-leilão (sem supervisor central) |
| Metade do enxame pode sumir atrás de uma cratera | **CRDT** (consistência eventual), nunca consenso forte (Raft trava sem quórum) |
| Alocação precisa respeitar distância, capacidade e dependências | **Leilão (Contract Net)** no lugar de fila de jobs |
| Mesmo produto deve atender outros domínios | **Adaptador plugável** + perfis de capacidade (lunar / mineração / resgate) |

---

## 3. Público-alvo e impacto (10 pts)

### 3.1. Público-alvo primário — exploração espacial / construção lunar

Operadores de missão, agências espaciais e prime contractors responsáveis por **infraestrutura lunar autônoma** (habitats, energia, mobilidade pressurizada) que precisa ser erguida antes da presença humana.

**Por que se beneficiam:** é exatamente o público que não pode ter humano no loop tático por causa da latência, e cuja operação é definida por falha de hardware em ambiente abrasivo. A autocura do enxame transforma falha de rover de *parada de obra* em *evento de rotina absorvido pelo sistema*.

**Dimensionamento do impacto:**

- O **mercado de robótica espacial** deve crescer de **US$ 4,52 bi (2024) para ~US$ 7,1–8,0 bi até 2030** (CAGR de ~9–9,5%), puxado justamente por missões de utilização de recursos e **construção de habitats** lunares/marcianos. ([Grand View Research](https://www.grandviewresearch.com/industry-analysis/space-robotics-market), [Knowledge Sourcing](https://www.knowledge-sourcing.com/report/space-robotics-market))
- A **NASA anunciou (mar/2026) um plano de US$ 20 bilhões em 7 anos** para construir uma base lunar perto do polo sul, com habitats, rovers pressurizados e energia nuclear — confirmando demanda real e financiada por orquestração autônoma de construção. ([CBS News](https://www.cbsnews.com/news/nasa-moon-base-plan-lunar-south-pole/), [Spaceflight Now](https://spaceflightnow.com/2026/03/25/nasa-outlines-ambitious-20-billion-plan-for-moon-base/))
- O programa **Artemis** já soma um custo estimado de **~US$ 93 bilhões até 2025** — a escala em que ganhos de robustez e autonomia têm impacto financeiro material. ([Space.com](https://www.space.com/nasa-artemis-moon-program-93-billion-2025), [Bloomberg](https://www.bloomberg.com/news/articles/2026-03-24/nasa-will-spend-20-billion-to-fast-track-moon-base-construction))

### 3.2. Público-alvo secundário — mineração de alto risco (spin-off)

Operadoras de mineração que querem **remover pessoas das zonas de risco**. O mesmo core (estado global + leilão + autocura) atende, trocando apenas o **adaptador de robô** e o **perfil de capacidade**.

**Por que se beneficiam:** soterramento e acidentes com equipamento pesado são exatamente o tipo de falha que a autocura absorve sem parar a operação.

**Dimensionamento do impacto:**

- O **mercado de automação de mineração** deve ir de **US$ 3,96 bi (2025) para ~US$ 5,93 bi até 2030** (CAGR ~8,4%). ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/mining-automation-market-257609431.html))
- **Segurança é o principal driver:** equipamento autônomo reduz acidentes de trabalho em até **30%**, e a BHP reportou **redução de 80% de acidentes** numa frota de 367 caminhões autônomos — operação remota, "zero-harm". ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/mining-automation-market-257609431.html), [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/automated-mining-equipment-market))

### 3.3. Público-alvo terciário — busca e resgate em desastres (spin-off)

Equipes de defesa civil e resposta a desastres que precisam **limpar escombros e localizar vítimas pós-terremoto** em ambiente instável, onde a comunicação cai e o terreno muda — o mesmo perfil de partição + falha que o core foi desenhado para sobreviver.

**Dimensionamento do impacto:**

- O **mercado de robôs de busca e resgate** deve crescer de **US$ 25–35 bi (2024–2025) para ~US$ 67–70 bi até 2030** (CAGR de ~13–15%). ([Market Research Future](https://www.marketresearchfuture.com/reports/search-and-rescue-robots-market-10599), [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/search-and-rescue-robots-market))

### 3.4. Síntese do impacto

| Domínio (perfil de capacidade) | Mercado-alvo até 2030 | Benefício central |
|---|---|---|
| **Construção lunar** (primário) | Robótica espacial ~US$ 7–8 bi · base lunar NASA US$ 20 bi | Obra autônoma que tolera falha sob latência inviável para comando remoto |
| **Mineração de alto risco** (spin-off) | Automação de mineração ~US$ 5,9 bi | Tirar vidas da zona de risco; −30% a −80% de acidentes |
| **Busca e resgate** (spin-off) | Robôs de SAR ~US$ 67–70 bi | Operar em terreno instável com comunicação intermitente |

> **Tese de negócio:** um único core de orquestração (estado global + leilão + autocura), validado no cenário lunar, é **portável** para mercados que somam **dezenas de bilhões de dólares** até 2030 — trocando apenas o adaptador e o perfil de capacidade, sem reescrever a plataforma.

---

## Fontes

- Space Robotics Market — [Grand View Research](https://www.grandviewresearch.com/industry-analysis/space-robotics-market) · [Knowledge Sourcing](https://www.knowledge-sourcing.com/report/space-robotics-market)
- Base lunar / Artemis — [CBS News](https://www.cbsnews.com/news/nasa-moon-base-plan-lunar-south-pole/) · [Spaceflight Now](https://spaceflightnow.com/2026/03/25/nasa-outlines-ambitious-20-billion-plan-for-moon-base/) · [Space.com](https://www.space.com/nasa-artemis-moon-program-93-billion-2025) · [Bloomberg](https://www.bloomberg.com/news/articles/2026-03-24/nasa-will-spend-20-billion-to-fast-track-moon-base-construction)
- Mining Automation — [MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/mining-automation-market-257609431.html) · [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/automated-mining-equipment-market)
- Search & Rescue Robots — [Market Research Future](https://www.marketresearchfuture.com/reports/search-and-rescue-robots-market-10599) · [Mordor Intelligence](https://www.mordorintelligence.com/industry-reports/search-and-rescue-robots-market)
</content>
