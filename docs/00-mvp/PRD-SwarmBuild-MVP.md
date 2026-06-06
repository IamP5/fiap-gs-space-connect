# PRD — SwarmBuild: Orquestração de Enxame para Ambientes Hostis (MVP)

> **Triage label:** `ready-for-agent`
> **Status:** greenfield (sem codebase existente) · **Stack-alvo:** Go (core), NATS (barramento), Angular + WebGL (dashboard), Docker Compose (deploy)
> **Nota:** nenhum issue tracker configurado no ambiente — este documento é o artefato publicável; colar como issue/épico e aplicar a label acima.

---

## Problem Statement

A base Artemis precisa ser construída por robôs operários **antes** dos humanos chegarem. O ambiente é hostil: poeira lunar (regolito) altamente abrasiva e terreno irregular. Nessas condições os robôs **vão falhar e quebrar** — não é exceção, é o comportamento esperado.

O problema central é a **latência Terra–Lua (~2,6s ida-e-volta, mais com relay)**, que torna impossível ter um operador na Terra no loop de controle tático. Se a escavadeira A pifa dentro de uma cratera, ninguém na Terra consegue reagir a tempo de realocar a escavadeira B. Programar cada robô individualmente também não escala nem tolera falha: quando um morre, a obra para naquele ponto.

Operadores de missão precisam de uma forma de a obra **se reorganizar sozinha** quando robôs falham, sem intervenção da Terra, mantendo todos os robôs com uma visão coerente do estado da construção mesmo quando perdem comunicação entre si.

## Solution

Uma plataforma de software de **controle de enxame** (swarm intelligence). Em vez de programar robôs individualmente, o operador define um **blueprint de construção de alto nível** e o sistema:

- Decompõe o blueprint em tarefas atômicas respeitando dependências (não assenta parede sem fundação).
- Mantém um **estado global da construção compartilhado** entre todos os robôs, tolerante a partição de rede.
- Aloca tarefas aos robôs por **leilão** — cada robô dá lance com base em distância, bateria e capacidade; o de menor custo ganha.
- Detecta falha por ausência de sinal e **realoca automaticamente a tarefa para outro robô** — sem nenhuma intervenção da Terra.

A decisão tática vive na **borda** (um lander ou peer-to-peer entre os robôs); a Terra só define metas e recebe telemetria por um canal assíncrono de alta latência.

A mesma arquitetura é portável: trocando o **adaptador de robô** e o **perfil de capacidade**, o produto atende mineração em áreas de alto risco e equipes de resgate em escombros pós-terremoto. O core (estado global + leilão + auto-cura) é idêntico; Lua, mina e escombro são apenas perfis diferentes.

## User Stories

### Planejamento e blueprint

1. Como operador de missão, quero definir um blueprint de construção de alto nível, para que o enxame saiba o que construir sem eu programar cada robô.
2. Como planejador de construção, quero declarar dependências entre etapas (ex: fundação antes de parede), para que o sistema nunca execute tarefas fora de ordem.
3. Como planejador de construção, quero que um blueprint com dependência cíclica seja rejeitado na submissão, para que eu descubra o erro antes da obra começar.
4. Como operador de missão, quero ver o blueprint decomposto em tarefas atômicas, para que eu entenda a granularidade do que será executado.
5. Como operador de missão, quero atualizar o blueprint com a obra em andamento, para que mudanças de plano não exijam reiniciar tudo.

### Alocação por leilão

6. Como operador de missão, quero que cada tarefa seja atribuída ao robô de menor custo disponível, para que a obra use os recursos de forma eficiente.
7. Como o coordenador do enxame, quero que robôs sem a capacidade necessária não recebam a tarefa, para que tarefas só vão para quem consegue executá-las.
8. Como o coordenador do enxame, quero que o lance considere distância, bateria e carga atual do robô, para que o robô mais apto e mais próximo seja escolhido.
9. Como o coordenador do enxame, quero desempate determinístico entre lances iguais, para que a alocação seja reproduzível e auditável.
10. Como operador de missão, quero que uma tarefa sem nenhum robô elegível fique pendente e visível, para que eu saiba que falta capacidade no enxame.
11. Como o coordenador do enxame, quero re-anunciar uma tarefa liberada para um novo leilão, para que ela seja reatribuída assim que houver candidato.

### Leases, heartbeat e auto-cura (o núcleo do produto)

12. Como o coordenador do enxame, quero conceder a tarefa como um *lease* com tempo de expiração (TTL), para que nenhuma tarefa fique presa a um robô morto.
13. Como um robô, quero renovar meu lease batendo heartbeat enquanto executo, para que minha tarefa não seja tomada de mim enquanto estou trabalhando.
14. Como o coordenador do enxame, quero expirar o lease quando o robô para de bater heartbeat além do limite, para que a tarefa volte ao pool de alocação.
15. Como operador de missão, quero que a tarefa de um robô que pifou seja automaticamente reatribuída a outro robô, para que a obra continue sem eu intervir da Terra.
16. Como o coordenador do enxame, quero que a liberação de uma tarefa expirada aconteça exatamente uma vez, para que ela não seja duplicada nem perdida.
17. Como operador de missão, quero acompanhar o ciclo de vida de cada tarefa (não-alocada → alocada → concluída), para que eu veja o progresso real da construção.

### Estado global compartilhado (tolerante a partição)

18. Como um robô, quero operar com minha fatia local do estado quando perco comunicação, para que eu continue produtivo mesmo particionado.
19. Como o coordenador do enxame, quero reconciliar o estado quando o link volta, para que o enxame convirja para uma visão única da obra.
20. Como o coordenador do enxame, quero que reivindicações concorrentes sobre a mesma tarefa sejam resolvidas de forma determinística, para que dois robôs nunca executem a mesma tarefa em duplicidade.
21. Como operador de missão, quero que o estado global sobreviva à perda temporária de qualquer robô, para que falhas individuais não corrompam a visão da obra.
22. Como engenheiro de confiabilidade, quero que a mescla de estados seja independente da ordem de chegada das mensagens, para que partições e reconexões não gerem estados divergentes.

### Autonomia local do robô

23. Como um robô, quero executar a tarefa concedida com lógica de comportamento própria (mover, trabalhar, reportar), para que eu não dependa de comando contínuo da Terra.
24. Como um robô, quero ter reflexos de segurança locais (ex: parar se a inclinação passar do limite), para que eu não me danifique em terreno irregular.
25. Como um robô, quero reportar falha de execução ao perder capacidade, para que minha tarefa seja liberada rapidamente para outro.
26. Como um robô, quero consumir bateria ao longo da operação, para que meu custo de lance reflita meu estado real.

### Comunicação e barramento

27. Como o coordenador do enxame, quero publicar anúncios de tarefa e receber lances por um barramento pub/sub, para que a alocação funcione de forma desacoplada.
28. Como um robô, quero publicar telemetria (posição, bateria, saúde, progresso) periodicamente, para que o sistema saiba meu estado atual.
29. Como o coordenador do enxame, quero entregar mensagens com store-and-forward para robôs temporariamente offline, para que nenhum comando se perca na partição.

### Controle de missão (Terra)

30. Como operador de missão, quero enviar metas de alto nível por um canal assíncrono, para que a alta latência não bloqueie a operação do enxame.
31. Como operador de missão, quero visualizar um digital twin do canteiro ao vivo, para que eu acompanhe a construção remotamente.
32. Como operador de missão, quero poder fazer um override raro de alto nível, para que eu retome controle em situações excepcionais sem microgerenciar.

### Dashboard, simulação e demonstração

33. Como operador de missão, quero ver o enxame, o progresso da obra e a saúde dos robôs em tempo real, para que eu entenda a situação num relance.
34. Como avaliador do produto, quero matar um robô ao vivo pelo dashboard e ver a tarefa ser reatribuída e concluída por outro, para que eu comprove a auto-cura em segundos.
35. Como avaliador do produto, quero ajustar a latência artificial Terra↔canteiro por um slider, para que eu comprove que a autonomia funciona sem operador no loop.
36. Como operador de missão, quero injetar uma probabilidade de falha nos robôs simulados, para que eu teste o comportamento do enxame sob estresse.

### Adaptador e spin-off (portabilidade)

37. Como engenheiro de plataforma, quero que o core de orquestração se comunique com os robôs através de um adaptador plugável, para que eu troque simulação por hardware real sem mexer no core.
38. Como engenheiro de plataforma, quero definir perfis de capacidade por domínio (lunar, mineração, resgate), para que o mesmo enxame atenda cenários diferentes só trocando o perfil.
39. Como gerente de produto, quero que mineração e resgate reusem o core integralmente, para que o spin-off comercial não exija reescrever a plataforma.

### Observabilidade

40. Como engenheiro de confiabilidade, quero registrar leilões, concessões e expirações, para que eu possa auditar por que cada tarefa foi para cada robô.
41. Como engenheiro de confiabilidade, quero reproduzir (replay) uma sessão de construção, para que eu investigue falhas sem reexecutar tudo ao vivo.

## Implementation Decisions

### Recorte de módulos

O sistema se decompõe em módulos profundos (lógica pesada, interface simples, mudam pouco) e módulos de fronteira (acoplados a infra/sim, integração).

Módulos profundos — **recebem dados puros e devolvem decisões, sem dependência de NATS nem da simulação**:

- **Allocation Engine** — implementa o Contract Net. Interface: recebe um anúncio de tarefa + o conjunto de estados de robôs candidatos; devolve o vencedor (ou nenhuma atribuição). Função de custo determinística.
- **Lease Manager** — gerencia concessões com TTL e heartbeat sobre um clock injetável. Interface: conceder, renovar (heartbeat), tique do relógio; emite eventos de expiração/liberação. Garante liberação idempotente.
- **World Model (CRDT)** — mantém o estado global da construção como estrutura de dados sem conflito. Interface: aplicar operação, mesclar estados, consultar. Mescla comutativa e idempotente.
- **Task Planner (DAG)** — transforma blueprint em grafo de tarefas e calcula o conjunto pronto. Interface: carregar blueprint (rejeita ciclo), listar tarefas prontas, marcar concluída (libera dependentes).

Módulos de fronteira (integração):

- **Robot Agent** — behavior tree/máquina de estado que executa a tarefa, dreno de bateria e reflexos de segurança. Stateful e acoplado ao ambiente.
- **Robot Adapter / Sim Engine** — a costura plugável entre o core e o "mundo". No MVP, um sim grid 2D em Go; pós-MVP, adaptador ROS 2/Gazebo. **É a fronteira que habilita o spin-off** (lunar/mineração/resgate).
- **Bus Transport** — wrapper fino sobre o NATS (pub/sub, request-reply, KV). Mantido propositalmente raso para isolar a infra.

### Decisões arquiteturais

- **Consistência eventual via CRDT, nunca consenso forte (Raft).** Raft exige quórum; quando metade do enxame some atrás de uma cratera, o quórum quebra e o sistema trava. CRDT permite operação particionada com reconciliação posterior.
- **Barramento: NATS** em vez de Kafka. Justificativa: pub/sub + request-reply (encaixa no leilão) + JetStream para durabilidade + NATS KV que já entrega estado compartilhado simples para o MVP. O padrão é mensagem pequena e bidirecional — Kafka é peso-pesado demais para isso. Kafka fica como fallback conhecido se necessário.
- **Alocação por Contract Net Protocol (leilão)** em vez de fila de jobs. Justificativa: fila não conhece custo espacial (robô mais próximo), não casa capacidade, não respeita o DAG e não tolera partição.
- **Auto-cura = lease com TTL + heartbeat + re-leilão.** A "realocação automática" emerge de timeout + leilão, sem lógica de supervisão centralizada especial.
- **Autonomia na borda.** O coordenador roda em um nó de borda (lander) com fallback peer-to-peer; a Terra é assíncrona e fora do loop tático por causa da latência.
- **Core agnóstico de transporte e de mundo.** O Allocation Engine, Lease Manager, World Model e Task Planner não importam NATS nem a sim — recebem dados e devolvem decisões. Isso é o que os torna unit-testáveis em milissegundos.
- **Dashboard via WebSocket** consumindo o estado ao vivo do core; render em Canvas/WebGL (Angular).
- **Deploy local em Docker Compose**, espelhando o ambiente de orquestração já em uso; GCP em fase posterior.

### Encodings de decisão (derivados do desenho em conversa)

Função de custo do lance (Allocation Engine) — encoda a política de seleção:

```
cost = w_dist · dist_para_tarefa
     + w_bat  · (1 / bateria)
     + w_cap  · penalidade_capacidade
     + w_load · carga_atual

# robôs com penalidade_capacidade = ∞ NÃO dão lance
# menor cost vence; empate → menor robot_id (determinístico)
```

Máquina de estado do lease (Lease Manager) — encoda o ciclo de auto-cura:

```
UNCLAIMED --(award)------------> LEASED
LEASED    --(heartbeat)--------> LEASED      (TTL reiniciado)
LEASED    --(complete)---------> DONE        (terminal)
LEASED    --(TTL expira | robô perdido)--> UNCLAIMED   (re-leilão)
```

Forma do registro de tarefa no World Model — encoda o que precisa convergir:

```
Task {
  task_id, type,
  deps: [task_id],
  status: UNCLAIMED | LEASED | DONE,
  assignee?: robot_id,
  lease_expiry?: timestamp
}
```

## Testing Decisions

### O que é um bom teste

Testar **comportamento externo** da interface do módulo, nunca detalhes de implementação. O teste passa um conjunto de entradas pela interface pública e afirma o resultado observável — sem inspecionar estado interno nem acoplar à estrutura de dados privada. Como os quatro módulos profundos não dependem de NATS nem da simulação, os testes são determinísticos e rápidos (sem rede, sem relógio de parede).

### Módulos com teste de unidade (confirmados): todos os quatro profundos

- **Allocation Engine** — dado uma tarefa + N estados de robôs, afirma que o vencedor é o de menor custo válido; robôs sem capacidade são excluídos; empate resolve pelo menor `robot_id`; sem candidato elegível → nenhuma atribuição. Propriedade: adicionar um robô estritamente pior nunca muda o vencedor.
- **Lease Manager** — concessão nasce com TTL; heartbeat estende o TTL; ausência de heartbeat além do limite emite expiração; a liberação de tarefa acontece exatamente uma vez (idempotente). Usa **clock injetável** para controlar o tempo no teste.
- **World Model (CRDT)** — convergência: o mesmo conjunto de operações aplicado em qualquer ordem produz estado idêntico; reivindicações concorrentes sobre a mesma tarefa resolvem de forma determinística; mescla é comutativa e idempotente.
- **Task Planner (DAG)** — o conjunto "pronto" contém exatamente as tarefas cujas dependências estão concluídas; blueprint com ciclo é rejeitado; concluir uma tarefa desbloqueia os dependentes; ordenação topológica correta.

### Módulos de fronteira

Robot Agent, Robot Adapter/Sim Engine e Bus Transport são cobertos por **testes de integração** (não unidade), exercitando o fluxo ponta-a-ponta com a sim. Fora do escopo de unidade do MVP.

### Prior art

Greenfield — não há testes existentes no repo. Esta entrega **estabelece o padrão**: testes table-driven em Go (estilo idiomático da linguagem) e o padrão de injeção de clock determinístico para o Lease Manager. Esses viram a referência para o restante do projeto.

## Out of Scope

- Integração com hardware real e com ROS 2/Gazebo (épico 7, pós-MVP).
- Comunicação lunar real / Deep Space Network — a latência é apenas **simulada** por slider no MVP.
- Simulação fisicamente precisa do regolito ou do terreno — o sim do MVP é um grid 2D com hazards e probabilidade de falha, não um motor físico.
- Os perfis de capacidade de mineração e resgate em si — o MVP entrega apenas a **costura do adaptador** que os habilita, não os perfis comerciais.
- Federação multi-canteiro / múltiplos enxames coordenados.
- Hardening de segurança, autenticação e autorização do barramento.
- Visualização 3D — o dashboard do MVP é 2D.
- Persistência durável além de in-memory + NATS KV.
- Alocação baseada em ML — a função de custo do MVP é heurística e determinística.

## Further Notes

- A demo de **matar um robô ao vivo e ver a obra se curar** (user story 34) é o pitch inteiro em ~30 segundos e deve ser o critério de aceite visível do MVP. O **slider de latência** (user story 35) é a prova de que a autonomia não depende da Terra.
- O **adaptador plugável + perfis de capacidade** não é só técnico: é o argumento de negócio do spin-off. Mineração (evitar soterramento de vidas) e resgate (limpar escombros pós-terremoto) reusam o core inteiro.
- A simulação pode ser plugada num harness multi-agente já existente (MiroFish) como cenário de SDLC/operação de enxame, em vez de construir um runner do zero.
- Sequência sugerida de épicos: (1) sim + agentes, (2) estado global + telemetria, (3) orquestrador/DAG, (4) leilão + lease, (5) saúde/auto-cura, (6) dashboard + injeção de falha + latência, (7) adaptador ROS 2 + perfis de spin-off.
