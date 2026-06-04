# SwarmBuild — Diagramas C4 (PT-BR)

> Derivado de [TECHSPEC.md](./TECHSPEC.md), da linguagem de domínio em [CONTEXT.md](../CONTEXT.md) e das decisões em [docs/adr/](./adr/).
> Renderizado com o suporte a C4 do Mermaid. Níveis: **Contexto** (o sistema no seu ambiente) e **Contêiner** (unidades de runtime dentro do sistema).
>
> Este C4 descreve a **arquitetura definida como um todo** — a ideia completa, não apenas o que já está codado. O que já está implementado vs. o que é *next step* está marcado na legenda de status ao final.

---

## Nível 1 — Contexto do Sistema

Como o SwarmBuild se posiciona entre as pessoas que assistem à demo e o link de alta latência com a Terra. A tese central: a **autocura tática acontece no canteiro de obras**, nunca esperando a Terra responder.

```mermaid
flowchart LR
    avaliador["👤 <b>Avaliador / Operador</b><br/><i>Pessoa</i><br/>Assiste à demo, autora o blueprint,<br/>aciona os controles de matar rover /<br/>latência / probabilidade de falha"]

    swarmbuild["🛰️ <b>SwarmBuild</b><br/><i>Sistema de Software</i><br/>Um canteiro que re-leiloa tarefas que<br/>falharam e se cura sozinho, sem<br/>operador no loop de controle"]

    terra["🌍 <b>Terra (Controle de Missão)</b><br/><i>Sistema Externo</i><br/>Lado remoto de alta latência. Define<br/>metas, recebe telemetria. Deliberadamente<br/>FORA do loop tático"]

    avaliador -->|"Vê o canteiro 3D; comandos de<br/>matar / latência / falha<br/><i>WebSocket</i>"| swarmbuild
    swarmbuild -->|"Telemetria sobe; metas descem<br/><i>earth.uplink (link lento simulado)</i>"| terra
    terra -.->|"Apenas metas de alto nível<br/>(nunca decisão tática)<br/><i>earth.uplink</i>"| swarmbuild

    classDef pessoa fill:#08427b,stroke:#052e56,color:#ffffff
    classDef sistema fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef ext fill:#6b6b6b,stroke:#4d4d4d,color:#ffffff
    class avaliador pessoa
    class swarmbuild sistema
    class terra ext
    linkStyle default stroke:#666,stroke-width:1.5px
```

**Leitura:** o operador nunca comanda rovers individualmente — ele autora um **blueprint** (o que construir) e aciona controles de demonstração. A Terra está fora do loop tático **de propósito**: o atraso ida-e-volta Terra–Lua (~2,6 s, mais com relay) torna impossível reagir a uma falha a tempo. Toda decisão tática (leilão, lease, re-leilão) vive na borda.

---

## Nível 2 — Contêiner

As unidades de runtime. O **processo Coordenador** (Go) abriga os quatro módulos profundos puros, o *tick* de escritor único, a coreografia e os rovers in-process. O **WS Gateway** é a única coisa com que o navegador conversa. O **NATS** está no caminho crítico ([ADR-0002](./adr/0002-nats-on-the-critical-path.md)); o **contêiner de rover** opcional é o bis ([ADR-0001](./adr/0001-in-process-rovers-with-container-encore.md)).

```mermaid
flowchart TB
    avaliador["👤 <b>Avaliador / Operador</b><br/><i>Pessoa</i><br/>Assiste e conduz a demo"]

    subgraph swarmbuild["🛰️ SwarmBuild"]
        direction TB
        web["<b>Dashboard Web</b><br/><i>React · Vite · react-three-fiber</i><br/>Cena lunar 3D (fallback 2D).<br/>Puro re-render a partir dos snapshots.<br/>Nunca fala NATS diretamente"]
        gateway["<b>WS Gateway</b><br/><i>Go</i><br/>Escuta o NATS, distribui um snapshot<br/>único do mundo (~10 Hz) + stream de<br/>coreografia; repassa os controles"]

        subgraph coordinator["⚙️ Processo Coordenador · Go"]
            direction LR
            tick["<b>Tick de escritor único +<br/>Coreografia</b><br/><i>goroutine Go</i><br/>Serializa award vs. expiração<br/>(elimina dupla-atribuição)"]
            deep["<b>Módulos Profundos</b><br/><i>Go — puros, property-tested</i><br/>Alocação · Lease ·<br/>World Model · Task Planner"]
            agents["<b>Robot Agents ×5–6</b><br/><i>goroutines Go, --mode=inproc</i><br/>Behaviour tree, dreno de bateria,<br/>injeção de falha"]
            adapter["<b>Adaptador (a costura)</b><br/><i>interface Go</i><br/>Fronteira: core ↔ mundo"]

            tick -->|"decisões puras<br/><i>in-process</i>"| deep
            agents -->|"atua sobre / lê o mundo<br/><i>in-process</i>"| adapter
        end

        nats[("<b>Servidor NATS</b><br/><i>NATS · JetStream · KV</i><br/>Barramento no caminho crítico.<br/>Espelho KV do World Model")]
        rover["<b>Contêiner de Rover (bis)</b><br/><i>Go — mesmo binário, --mode=container</i><br/>Stretch opcional: um rover como<br/>sistema separado em execução,<br/>morto via docker por um sidecar"]
    end

    terra["🌍 <b>Terra (Controle de Missão)</b><br/><i>Sistema Externo</i><br/>Lado remoto de alta latência,<br/>fora do loop tático"]

    avaliador -->|"Vê o canteiro;<br/>aciona controles<br/><i>Navegador</i>"| web
    web -->|"Snapshots + eventos descem;<br/>comandos de controle sobem<br/><i>WebSocket</i>"| gateway
    gateway -->|"Escuta subjects;<br/>repassa controles<br/><i>NATS</i>"| nats
    tick -->|"Anuncia tarefas, awards,<br/>espelho KV · <i>NATS</i>"| nats
    agents -->|"Lances, heartbeats,<br/>telemetria · <i>cliente NATS</i>"| nats
    rover -.->|"Mesmo protocolo de leilão /<br/>heartbeat<br/><i>cliente NATS</i>"| nats
    nats -->|"Telemetria sobe; metas descem<br/>(shim de latência só no earth.uplink)<br/><i>earth.uplink</i>"| terra

    classDef pessoa fill:#08427b,stroke:#052e56,color:#ffffff
    classDef container fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef db fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef ext fill:#6b6b6b,stroke:#4d4d4d,color:#ffffff
    classDef bis fill:#3b78c3,stroke:#0b4884,color:#ffffff,stroke-dasharray:4 3
    class avaliador pessoa
    class web,gateway,tick,deep,agents,adapter container
    class nats db
    class rover bis
    class terra ext
    style swarmbuild fill:#f2f6fb,stroke:#a8c2e0,color:#1a1a1a
    style coordinator fill:#e3edf8,stroke:#7aa6d6,color:#1a1a1a
    linkStyle default stroke:#666,stroke-width:1.5px
```

---

## Nível 3 — Componentes (Processo Coordenador)

Zoom no Coordenador: como os quatro **módulos profundos** puros se conectam ao mundo vivo através de um único escritor. Esta é a substância de engenharia do produto ([ADR-0003](./adr/0003-single-writer-live-path-crdt-as-tested-module.md)).

```mermaid
flowchart TB
    subgraph coordinator["⚙️ Processo Coordenador · Go"]
        direction TB

        writer["<b>Tick de Escritor Único</b><br/><i>goroutine Go · um canal de eventos</i><br/>TODA mutação de estado passa por aqui.<br/>Award e expiração nunca se entrelaçam →<br/>nenhuma tarefa é atribuída em duplicidade"]

        subgraph deepmods["Módulos Profundos (puros · property-tested)"]
            direction LR
            planner["<b>Task Planner (DAG)</b><br/><i>core/planner</i><br/>Blueprint → grafo. Rejeita ciclos e<br/>deps soltas. Calcula o ready set;<br/>marcar DONE desbloqueia dependentes"]
            alloc["<b>Allocation Engine</b><br/><i>core/allocation</i><br/>Contract Net. cost = w_dist·dist +<br/>w_bat·(1/bateria) + w_load·carga.<br/>Menor custo vence; empate → menor id"]
            lease["<b>Lease Manager</b><br/><i>core/lease</i><br/>TTL + heartbeat sobre clock injetável.<br/>Expiração libera a tarefa<br/>EXATAMENTE uma vez (idempotente)"]
            world["<b>World Model</b><br/><i>core/world</i><br/>Estado autoritativo de escritor único<br/>+ Merge CRDT puro (comutativo,<br/>idempotente, associativo)"]
        end

        adapter["<b>Adaptador (a costura)</b><br/><i>interface Go</i><br/>Fronteira core ↔ mundo.<br/>Trocar isto (não o core) habilita os<br/>spin-offs de mineração / resgate"]
        agents["<b>Robot Agents ×5–6</b><br/><i>goroutines · behaviour tree</i><br/>Move, trabalha, reporta. Dreno de<br/>bateria, reflexos de segurança,<br/>injeção de falha"]
    end

    nats[("<b>Servidor NATS</b><br/><i>JetStream · KV</i>")]

    writer -->|"carrega blueprint, lê ready set"| planner
    writer -->|"roda o leilão"| alloc
    writer -->|"concede / renova / expira"| lease
    writer -->|"aplica mutações, espelha p/ KV"| world
    lease -.->|"evento de expiração →<br/>re-enfileira re-leilão"| writer
    agents -->|"lances, heartbeats, telemetria"| adapter
    adapter -->|"pub/sub"| nats
    writer -->|"announce / award · espelho KV"| nats

    classDef writer fill:#08427b,stroke:#052e56,color:#ffffff
    classDef deep fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef frontier fill:#3b78c3,stroke:#0b4884,color:#ffffff
    classDef db fill:#1168bd,stroke:#0b4884,color:#ffffff
    class writer writer
    class planner,alloc,lease,world deep
    class adapter,agents frontier
    class nats db
    style coordinator fill:#e3edf8,stroke:#7aa6d6,color:#1a1a1a
    style deepmods fill:#f2f6fb,stroke:#a8c2e0,color:#1a1a1a
    linkStyle default stroke:#666,stroke-width:1.5px
```

**Por que escritor único + CRDT testado ([ADR-0003](./adr/0003-single-writer-live-path-crdt-as-tested-module.md)):** a autocura principal (expiração de lease + re-leilão) não precisa de merge — com um único escritor não há reivindicações concorrentes para reconciliar. O CRDT é construído e provado por *property tests* (histórias 18–22 do PRD) como módulo profundo; a tolerância a partição é demonstrada com os testes verdes de convergência, não improvisada ao vivo no palco.

---

## Relacionamentos-chave (subjects do barramento)

| Subject | Direção | Propósito |
|---|---|---|
| `task.announce` | Coordenador → barramento | Tarefa anunciada para leilão |
| `task.bid.<task_id>` | Rover → barramento | Rover submete seu custo (lance) |
| `task.award` | Coordenador → barramento | Vencedor recebe um lease |
| `robot.heartbeat.<id>` | Rover → barramento | Renovação de lease (nunca sofre shim de latência) |
| `robot.telemetry.<id>` | Rover → barramento | Posição, bateria, saúde, progresso |
| `control.command` | Navegador → Gateway → barramento | `kill` / `setLatency` / `setFailureProb` |
| `earth.uplink` | ↔ Terra | O **único** lugar onde vive o shim de latência |

---

## Status de implementação (o que está pronto vs. next steps)

Sequência robustez-primeiro, com cauda cortável (TECHSPEC §6). O C4 acima é a arquitetura-alvo completa; abaixo, o que cada parte já entrega hoje.

| # | Etapa | No C4 | Status |
|---|---|---|---|
| 1 | **Core profundo + testes** — Alocação, Lease, World Model, Task Planner | `Módulos Profundos` (Nível 3) | ✅ Pronto |
| 2 | **Sim + Coordenador** — rovers goroutine, behaviour tree, tick de escritor único | `Coordenador`, `Robot Agents`, `Adaptador` | ✅ Pronto |
| 3 | **NATS no caminho** — leilão/telemetria/uplink; espelho KV; bootstrap endurecido | `Servidor NATS`, subjects | ✅ Pronto |
| 4 | **WS Gateway + canvas 2D** — fluxo matar→curar→concluir visível | `WS Gateway`, `Dashboard Web` (2D) | ✅ Pronto |
| 5 | **Coreografia** — ritmar os beats a partir de eventos reais | `Coreografia` (Nível 2) | ⬜ Next step |
| 6 | **3D react-three-fiber** — trocar o renderer; 2D segue como fallback ([ADR-0004](./adr/0004-react-three-fiber-3d-built-2d-first.md)) | `Dashboard Web` (3D) | ⬜ Next step |
| 7 | **Stretch** — bis em contêiner; toggle de partição CRDT ao vivo | `Contêiner de Rover (bis)` | ⬜ Stretch |

> **Legenda:** ✅ implementado e testado · ⬜ definido na arquitetura, planejado para as próximas iterações. O caminho 2D já é a versão ensaiada de *fallback* do 3D; o contêiner de rover usa o **mesmo binário e o mesmo protocolo NATS** dos rovers in-process — o bis muda o *hosting*, não o protocolo.

---

## Notas para o leitor

- **Os módulos profundos são o produto.** Todo o resto (sim, barramento, gateway, web) existe para tornar esses quatro módulos puros *visíveis*.
- **O barramento está no caminho crítico** por decisão de projeto ([ADR-0002](./adr/0002-nats-on-the-critical-path.md)) — rovers in-process e em contêiner são ambos clientes NATS, então o bis muda o hosting, não o protocolo.
- **O navegador é um cliente puro** — snapshots de estado completo o tornam seguro a reconexão, sem deriva de simulação no lado do cliente.
- **Autocura = expiração + re-leilão**, composta sem nenhuma lógica de supervisão e sem a Terra no loop. Esse é o pitch inteiro.
- **Portabilidade pelo Adaptador** — trocar a costura (não o core) é o que habilita os spin-offs de mineração e resgate: o core (estado global + leilão + autocura) é idêntico; Lua, mina e escombros são apenas perfis de capacidade diferentes.
</content>
</invoke>
