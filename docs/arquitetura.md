# Arquitetura — billing-service

O billing-service cuida do **orçamento** da ordem de serviço e do **pagamento** que o libera para o reparo. É um dos três microsserviços da Fase 4 (os outros são o os-service e o execution-service) e participa do fluxo da OS como **participante**: recebe comandos do orquestrador por SQS, aplica a regra de negócio no seu próprio banco (DynamoDB) e responde com eventos no tópico SNS. Nenhum outro serviço lê ou escreve na tabela do billing.

## 1. Responsabilidade

| O billing faz | O billing não faz |
| --- | --- |
| Gera o orçamento a partir do comando `GerarOrcamento` (valida que o total é a soma dos itens) | Decidir o rumo da OS: quem coordena os passos é o orquestrador do os-service |
| Expõe ao cliente a consulta, a aprovação e a rejeição do orçamento | Guardar cliente, veículo ou catálogo como fonte de verdade (recebe uma cópia no comando) |
| Cria a cobrança de pagamento quando o cliente aprova e devolve o `linkPagamento` | Executar diagnóstico ou reparo (execution-service) |
| Cancela o orçamento e estorna o pagamento quando o orquestrador compensa | Publicar evento sem antes gravá-lo junto do efeito (outbox, seção 7) |
| Recebe a notificação de pagamento do Mercado Pago (webhook assinado), confirma na API e publica `PagamentoConfirmado` | |
| Publica o resultado de cada comando como evento (`OrcamentoGerado`, `OrcamentoCancelado`, `PagamentoEstornado` etc.) | |

Rotas, filas e mensagens completas estão em [`contratos/README.md`](../contratos/README.md).

## 2. Componentes (Clean Architecture)

Cada módulo segue as mesmas camadas do restante da solução: os *adapters* de entrada (controllers HTTP e consumidor SQS) chamam *use cases*; os use cases dependem apenas de **portas** (interfaces); os *adapters* de saída implementam essas portas.

```mermaid
flowchart LR
    subgraph entrada["Adapters de entrada"]
        ctrlCli["OrcamentosClienteController<br/>/billing/cliente/orcamentos"]
        ctrlStaff["OrcamentosController<br/>/billing/orcamentos"]
        ctrlWh["WebhookMercadoPagoController<br/>/billing/webhooks/mercado-pago"]
        cons["ConsumidorComandosBilling<br/>fila billing-comandos"]
    end

    subgraph app["Aplicação: use cases"]
        ucGerar["GerarOrcamento"]
        ucAprovar["AprovarOrcamento"]
        ucRejeitar["RejeitarOrcamento"]
        ucCancelar["CancelarOrcamento"]
        ucEstornar["EstornarPagamento"]
        ucConsulta["Consultar e Listar"]
        ucNotif["ProcessarNotificacaoPagamento"]
        ucReconc["ReconciliarPagamentos"]
        ucRegistrar["RegistrarPagamento"]
        ucRetentar["RetentarEstornos"]
        svcEventos["EventosOrcamentoService<br/>grava efeito + eventos e publica"]
        svcEstorno["EstornoService"]
    end

    subgraph dominio["Domínio"]
        orc["Orcamento<br/>fluxo-estados-orcamento"]
    end

    subgraph portas["Portas"]
        pOrc["OrcamentosGatewayPort"]
        pPag["GatewayPagamentoPort"]
        pPub["PublicadorMensagensPort"]
    end

    subgraph saida["Adapters de saída"]
        aDdb["OrcamentosDynamoDbGateway"]
        aMp["MercadoPagoGateway<br/>com MERCADO_PAGO_ACCESS_TOKEN"]
        aSim["GatewayPagamentoSimulado<br/>sem token: local e testes"]
        aSns["SnsSqsPublicador"]
        job["RepublicacaoEventosJob<br/>a cada 15 s"]
        jobEst["RetentativaEstornosJob<br/>a cada 60 s"]
    end

    ctrlCli --> ucAprovar & ucRejeitar & ucConsulta
    ctrlStaff --> ucConsulta & ucReconc
    ctrlWh --> ucNotif
    cons --> ucGerar & ucCancelar & ucEstornar
    ucNotif & ucReconc --> ucRegistrar
    ucGerar & ucAprovar & ucRejeitar & ucCancelar & ucRegistrar --> svcEventos
    ucEstornar & ucRetentar --> svcEstorno --> svcEventos
    ucGerar & ucAprovar & ucRejeitar & ucCancelar & ucEstornar & ucRegistrar --> orc
    ucAprovar & ucNotif & ucReconc & ucRegistrar --> pPag
    svcEstorno --> pPag
    ucGerar & ucAprovar & ucCancelar & ucEstornar & ucConsulta & ucReconc & ucRegistrar & ucRetentar --> pOrc
    svcEventos --> pOrc & pPub
    pOrc -.-> aDdb
    pPag -.-> aMp
    pPag -.-> aSim
    pPub -.-> aSns
    job --> svcEventos
    jobEst --> ucRetentar
    aDdb --> ddb[("DynamoDB<br/>oficina-billing-env")]
    aSns --> sns{{"SNS oficina-env-eventos"}}
    aMp --> mp(["Mercado Pago"])
```

Ligação das portas (`orcamentos.module.ts:58-59`): `ORCAMENTOS_GATEWAY` → `OrcamentosDynamoDbGateway` e `GATEWAY_PAGAMENTO` → `criarGatewayPagamento()` (`orcamentos.module.ts:31-35`), que devolve o `MercadoPagoGateway` quando há `MERCADO_PAGO_ACCESS_TOKEN` e, sem ele, o `GatewayPagamentoSimulado` com o aviso `billing.pagamento.gateway-simulado` no log.

**Pagamento.** O adapter real é o `MercadoPagoGateway` (`adapters/gateways/mercado-pago/`), sobre o SDK oficial `mercadopago` e a **API de Orders do Checkout Pro**, decisão registrada na [ADR 013](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-os-service/blob/main/docs/arquitetura/adrs/adr-013-pagamento-antes-do-reparo-mercado-pago.md). Ele implementa as quatro operações da porta (`gateway-pagamento.port.ts:51-57`):

| Operação | No Mercado Pago |
| --- | --- |
| `criarCobranca` | `orders.create` com `external_reference = orcamentoId`, os itens do orçamento, `expiration_time` igual ao prazo de pagamento da orquestração e chave de idempotência `order-<orcamentoId>`; devolve o `checkout_url` como `linkPagamento`. Uma nova tentativa com a mesma chave reaproveita a order já criada. |
| `consultarPagamento` | `orders.get` pelo id da order |
| `buscarPagamentosPorOrcamento` | `orders.search` por `external_reference` nos últimos 28 dias (usada pela reconciliação) |
| `estornar` | `orders.refund` com a chave de idempotência recebida |

O `GatewayPagamentoSimulado` (`gateway-pagamento.simulado.ts`) continua atrás da mesma porta: devolve um link `https://pagamento.simulado.local/checkout/<orcamentoId>`, guarda pagamentos e estornos em memória e não movimenta dinheiro. Ele atende o ambiente local sem conta e os testes BDD. Trocar um pelo outro não altera use cases nem domínio.

## 3. Rotas

Todas passam pelo API Gateway com o prefixo `/billing` (o gateway não reescreve o caminho). Documentação Swagger em `/billing/docs`.

| Rota | Quem | Use case |
| --- | --- | --- |
| `GET /billing/cliente/orcamentos/:numeroOs` | cliente dono da OS | consultar |
| `POST /billing/cliente/orcamentos/:numeroOs/aprovar` | cliente dono da OS | aprovar: `422` fora de `AGUARDANDO_APROVACAO` ou com prazo vencido |
| `POST /billing/cliente/orcamentos/:numeroOs/rejeitar` | cliente dono da OS | rejeitar: `422` fora de `AGUARDANDO_APROVACAO` |
| `GET /billing/orcamentos/:numeroOs` | `ATENDENTE`, `ADMINISTRADOR` | consultar |
| `GET /billing/orcamentos?status=` | `ATENDENTE`, `ADMINISTRADOR` | listar por status |
| `POST /billing/orcamentos/:numeroOs/reconciliar` | `ATENDENTE`, `ADMINISTRADOR` | reconciliar pagamentos (seção 8) |
| `POST /billing/webhooks/mercado-pago` | Mercado Pago, pública com `x-signature` | processar notificação de pagamento (seção 8) |
| `GET /health` | pública, sem prefixo | probe do Kubernetes |
| `GET /health/ready` | pública, sem prefixo | readiness (consulta o DynamoDB) |

Origem no código: `orcamentos-cliente.controller.ts` (`@Controller("billing/cliente/orcamentos")`, linhas 18, 26, 33 e 41), `orcamentos.controller.ts` (`@Controller("billing/orcamentos")`, linhas 17, 25, 32 e 39), `webhook-mercado-pago.controller.ts` (`@Controller("billing/webhooks")`, linhas 29 e 36).

## 4. Máquina de estados do orçamento

Os sete estados e as seis transições vêm de `status-orcamento.ts` e `fluxo-estados-orcamento.ts`. Toda mudança passa por `Orcamento.transicionar`, que lança `TransicaoInvalidaError` se o estado de origem não está na lista da transição.

```mermaid
stateDiagram-v2
    [*] --> AGUARDANDO_APROVACAO : GerarOrcamento
    AGUARDANDO_APROVACAO --> APROVADO : aprovar, cliente
    AGUARDANDO_APROVACAO --> REJEITADO : rejeitar, cliente
    AGUARDANDO_APROVACAO --> CANCELADO : cancelar, CancelarOrcamento
    APROVADO --> CANCELADO : cancelar, CancelarOrcamento
    APROVADO --> PAGO : confirmar_pagamento
    CANCELADO --> PAGO : confirmar_pagamento, pagamento atrasado
    PAGO --> ESTORNADO : estornar, EstornarPagamento
    PAGO --> ESTORNO_PENDENTE : registrar_falha_estorno
    ESTORNO_PENDENTE --> ESTORNO_PENDENTE : registrar_falha_estorno
    ESTORNO_PENDENTE --> ESTORNADO : estornar
    REJEITADO --> [*]
    ESTORNADO --> [*]
```

Observações, todas conferidas no código:

- **Estado inicial.** `Orcamento.criar` cria o orçamento em `AGUARDANDO_APROVACAO` com `versao = 1` (`orcamento.entity.ts:100`).
- **`CANCELADO → PAGO`.** Um pagamento que chega depois do cancelamento é registrado (campo `pagamentoAtrasado = true`, `orcamento.entity.ts:236-243`); o orquestrador então manda `EstornarPagamento`.
- **Cancelar depois de pago.** Se o orçamento já tem pagamento (`PAGO`, `ESTORNO_PENDENTE`, `ESTORNADO`), `CancelarOrcamento` não muda o status: o status reflete o dinheiro, e só registra `canceladoEm` e o motivo (`registrarCancelamentoSemMudarStatus`, `orcamento.entity.ts:225-233`). Em `REJEITADO` ou `CANCELADO` o comando só reemite o evento `OrcamentoCancelado`.
- **Quem dispara cada transição de pagamento.** `confirmar_pagamento` vem do `RegistrarPagamentoUseCase`, chamado pelo webhook e pela reconciliação (seção 8); `registrar_falha_estorno` e o `estornar` a partir de `ESTORNO_PENDENTE` vêm do `EstornoService`, chamado pelo comando `EstornarPagamento` e pela retentativa agendada (seção 9).

## 5. Modelo de dados: tabela única no DynamoDB

Uma tabela por ambiente, `oficina-billing-<env>` (`billing-dynamodb.tf` em `tc-oficina-infra-db`), chave primária `pk` (partição) + `sk` (ordenação) e um índice global `gsi1` (`gsi1pk`, `gsi1sk`, projeção `ALL`). O nome da tabela chega ao serviço pela variável `DYNAMODB_TABLE`. A tabela guarda sete tipos de item; cinco carregam o atributo `tipoItem` e os dois de deduplicação (`MSG#` e `WEBHOOK#`) só têm `processadaEm`.

| `tipoItem` | `pk` | `sk` | `gsi1pk` / `gsi1sk` | Para quê |
| --- | --- | --- | --- | --- |
| `ORCAMENTO` | `ORCAMENTO#<orcamentoId>` | `ORCAMENTO` | `STATUS#<status>` / `<criadoEm>#<orcamentoId>` | O orçamento (todos os campos do domínio, inclusive `versao`) |
| `PONTEIRO` | `OS#<osId>` | `ORCAMENTO` | — | Leva da OS ao `orcamentoId`; garante um orçamento por OS |
| `PONTEIRO` | `NUMERO_OS#<numeroOs>` | `ORCAMENTO` | — | Leva do número legível ao `orcamentoId` (rotas do cliente e da equipe) |
| `PAGAMENTO` | `ORCAMENTO#<orcamentoId>` | `PAGAMENTO#<pagamentoId>` | — | Pagamento conhecido pelo provedor, junto do orçamento |
| `EVENTO` | `EVENTO#<messageId>` | `EVENTO` | `EVENTO_PENDENTE` / `<ocorridoEm>#<messageId>` enquanto não publicado | Outbox: evento gravado na mesma transação do efeito |
| `—` | `MSG#<messageId>` | `MSG` | — | Mensagem de comando já processada (idempotência do consumidor) |
| `—` | `WEBHOOK#<pagamentoId>#<status>` | `WEBHOOK` | — | Notificação de pagamento já processada (idempotência do webhook) |
| `FLUXO_CANCELADO` | `FLUXO_CANCELADO#<fluxoId>` | `FLUXO` | — | Cancelamento que chegou antes do `GerarOrcamento` |

Fonte: `orcamentos.dynamodb.gateway.ts` — `chaveOrcamento` (linha 31), `itemOrcamento` (211-220), ponteiros em `criar` (93-105), `itensPagamentos` (244-257), `itensEventos` (259-278), `itensDedupe` (222-242), `registrarCancelamentoAntecipado` (143-165). O formato da chave `WEBHOOK#` (`<pagamentoId>#<status>`) está documentado no comentário de `EfeitosGravacao` (`orcamentos.gateway.ts:20-21`).

### Padrões de acesso

| Consulta | Como é feita |
| --- | --- |
| Orçamento por id | `GetItem` em `ORCAMENTO#<id>` / `ORCAMENTO`, leitura consistente |
| Orçamento por OS ou por número da OS | `GetItem` no ponteiro (`OS#...` ou `NUMERO_OS#...`) e depois no orçamento |
| Listar orçamentos por status | `Query` no `gsi1` com `gsi1pk = STATUS#<status>` (paginando); `gsi1sk` ordena por criação |
| Eventos a republicar | `Query` no `gsi1` com `gsi1pk = EVENTO_PENDENTE` e `gsi1sk < agora - 10 s`, no máximo 50 por rodada |
| Mensagem, notificação ou fluxo cancelado já visto | `GetItem` com leitura consistente na chave correspondente |

### Escritas transacionais e concorrência

Toda escrita de domínio usa **`TransactWriteItems`**: o efeito (orçamento, ponteiros, pagamentos), o registro de deduplicação (`MSG#` ou `WEBHOOK#`) e os eventos de saída entram ou saem juntos.

- **Criar** (`criar`, linhas 92-121): `Put` do orçamento e dos dois ponteiros com `attribute_not_exists(pk)` — uma segunda criação para a mesma OS falha com `OrcamentoJaExisteError`. Um `ConditionCheck` exige que não exista `FLUXO_CANCELADO#<fluxoId>`, para fechar a corrida com um cancelamento antecipado.
- **Atualizar** (`atualizar`, linhas 123-141): `Put` com `ConditionExpression: versao = :versaoAnterior` — escrita condicional por versão. Se duas operações leem a mesma versão, só a primeira grava; a outra recebe `ConflitoConcorrenciaError` (os use cases de aprovar e rejeitar transformam isso em `422`).
- **Mensagem duplicada:** se a condição do item de deduplicação falha, o gateway traduz para `MensagemJaProcessadaError` (`traduzir`, linhas 290-309) e o consumidor trata como já processada.

Na terminologia de transações distribuídas, a condição por `versao` é a contramedida de **reler o valor antes de atualizar** contra a anomalia de *lost update*: ninguém sobrescreve um orçamento que mudou entre a leitura e a escrita.

## 6. Mensagens

Contrato completo (envelope, atributos, catálogo, regras de idempotência e schemas): [`contratos/README.md`](../contratos/README.md).

| Sentido | Canal | Mensagens |
| --- | --- | --- |
| Consome | fila `oficina-<env>-billing-comandos` (DLQ `-dlq`) | `GerarOrcamento`, `CancelarOrcamento`, `EstornarPagamento` (`consumidor-comandos-billing.ts:31-40`) |
| Produz | tópico SNS `oficina-<env>-eventos`, `origem: billing` | `OrcamentoGerado`, `FalhaGerarOrcamento`, `OrcamentoAprovado`, `OrcamentoRejeitado`, `OrcamentoCancelado`, `PagamentoConfirmado` (webhook e reconciliação), `PagamentoEstornado`, `EstornoFalhou` (falha do estorno no provedor) |

Comportamento do consumidor (`consumidor-sqs.ts`): long polling de 20 s, lote de até 10, validação do envelope contra os schemas do contrato e **exclusão da mensagem só depois** de o use case terminar sem erro (linha 101). Mensagem fora do contrato ou erro de processamento não apagam: a mensagem volta após o visibility timeout e, na quinta entrega, vai para a DLQ.

Respostas de cada comando:

| Comando | Evento de resposta |
| --- | --- |
| `GerarOrcamento` | `OrcamentoGerado`; `FalhaGerarOrcamento{motivo:"VALOR_TOTAL_INCONSISTENTE"}` se o total não bate; `FalhaGerarOrcamento{motivo:"ORCAMENTO_ENCERRADO"}` se já houve orçamento da OS e ele não está mais ativo; `OrcamentoCancelado{orcamentoId:null}` se o fluxo já tinha sido cancelado |
| `CancelarOrcamento` | `OrcamentoCancelado` (com `orcamentoId:null` quando o orçamento ainda não existe) |
| `EstornarPagamento` | `PagamentoEstornado` (com `pagamentoId:null` e `valorCentavos:0` quando não há pagamento a estornar); `EstornoFalhou{proximaTentativaEm}` se o provedor falhar |

## 7. Idempotência e publicação confiável (outbox)

- **Consumidor idempotente.** Cada use case começa por `mensagemJaProcessada(messageId)` e grava o `MSG#<messageId>` na mesma transação do efeito. Reentrega da mesma mensagem não repete efeito nem evento. Quando o `messageId` é novo mas a ação já foi aplicada (por exemplo, cancelar um orçamento já cancelado), o billing registra o `messageId` e **reemite o evento de resultado**, para o orquestrador conseguir avançar.
- **Ordem não garantida.** O SQS Standard não ordena, então `CancelarOrcamento` pode chegar antes de `GerarOrcamento`. Nesse caso o billing grava `FLUXO_CANCELADO#<fluxoId>`, responde `OrcamentoCancelado` com `orcamentoId: null` e, quando o `GerarOrcamento` chegar, não cria orçamento (`cancelar-orcamento.use-case.ts:25-34`, `gerar-orcamento.use-case.ts:25-30`).
- **Outbox.** O evento é um item `EVENTO#` gravado na mesma transação do efeito. `EventosOrcamentoService` tenta publicar logo em seguida e, se publicar, remove o item do índice (`marcarEventoPublicado` faz `REMOVE gsi1pk, gsi1sk`). Se a publicação falhar, o `RepublicacaoEventosJob` varre `EVENTO_PENDENTE` a cada 15 s (`republicacao-eventos.job.ts:14`), com atraso mínimo de 10 s e lote de 50 (`eventos-orcamento.service.ts:15-16`). O trace distribuído é capturado uma vez e gravado junto do evento, e a republicação reenvia o mesmo contexto.

## 8. Webhook de pagamento

`POST /billing/webhooks/mercado-pago` (`webhook-mercado-pago.controller.ts`) é pública e responde `200` para assinatura válida (inclusive notificação duplicada ou de tipo ignorado), `401` para assinatura inválida e `503` em falha temporária, para o provedor reenviar. O API Gateway roteia essa rota sem authorizer e o `app.setup.ts` a isenta do rate limit (`ROTAS_SEM_LIMITE`, linha 15).

Caminho de uma notificação:

1. **Assinatura.** `validarAssinaturaMercadoPago` (`webhook/assinatura-mercado-pago.ts`) monta o manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, calcula o HMAC SHA-256 com `MERCADO_PAGO_WEBHOOK_SECRET` e compara com o `v1` do `x-signature` em tempo constante. Recusa também `ts` fora da tolerância de 1 hora. Falha gera `401` e o log `billing.webhook.assinatura-invalida` com o motivo.
2. **Tipo.** Só notificações de order (`type` `order` ou `orders_v2`) seguem; as demais respondem `200` com `processado: false`.
3. **Consulta.** `ProcessarNotificacaoPagamentoUseCase` ignora o corpo e consulta a order na API do Mercado Pago (`consultarPagamento`): o estado que vale é o do provedor, nunca o da notificação.
4. **Registro.** `RegistrarPagamentoUseCase` aplica as regras: pagamento não aprovado não muda nada (`NAO_APROVADO`); pagamento já registrado ou notificação já vista responde `JA_REGISTRADO`; um segundo pagamento do mesmo orçamento, valor diferente do orçamento ou orçamento em estado que não aceita pagamento são **estornados na hora**, sem passar pelo orquestrador; nos demais casos o orçamento vai a `PAGO` e `PagamentoConfirmado` entra na outbox, junto do item `WEBHOOK#<pagamentoId>#<status>` e do `PAGAMENTO#`, na mesma transação. Pagamento de orçamento já `CANCELADO` é confirmado com `pagamentoAtrasado = true`, e o orquestrador responde com `EstornarPagamento`.
5. **Falha temporária.** Conflito de versão ou erro temporário do provedor viram `503`, e o Mercado Pago reenvia.

**Reconciliação.** Quando uma notificação se perde, `POST /billing/orcamentos/:numeroOs/reconciliar` (staff) busca no Mercado Pago as orders do orçamento por `external_reference` e passa cada uma pelo mesmo `RegistrarPagamentoUseCase`. É idempotente: rodar de novo devolve `JA_REGISTRADO` para o que já foi confirmado.

## 9. Estorno e retentativa

`EstornarPagamento` (`estornar-pagamento.use-case.ts`) segue este caminho:

1. Mensagem já processada: sai sem efeito.
2. Orçamento sem pagamento ou já `ESTORNADO`: responde `PagamentoEstornado` imediatamente (com `pagamentoId: null` e valor `0` quando nunca houve pagamento), para o orquestrador não ficar preso compensando.
3. Caso normal: `EstornoService.estornar` chama `GatewayPagamentoPort.estornar(pagamentoId, "estorno-<orcamentoId>")`. A **chave de idempotência** faz o provedor devolver o mesmo estorno se a chamada se repetir (o adapter simulado reproduz esse comportamento, `gateway-pagamento.simulado.ts:40-41`). Em seguida o orçamento vai a `ESTORNADO` e `PagamentoEstornado` entra na outbox, tudo numa transação (`estorno.service.ts:23-46`).

**Falha do provedor** (`estorno.service.ts:56-87`). Antes de registrar a falha, o serviço consulta o pagamento: se ele já está `refunded` no Mercado Pago (reembolso pelo painel, por outra chave ou `409` de order já reembolsada), o estorno conta como feito. Caso contrário o orçamento vai a `ESTORNO_PENDENTE`, com `tentativasEstorno`, `proximaTentativaEstornoEm` e `ultimoErroEstorno` (`orcamento.entity.ts:249-255`), e `EstornoFalhou{proximaTentativaEm}` entra na outbox na mesma transação. O `messageId` do comando é gravado junto, então o comando não volta para a fila e uma reentrega não duplica o evento.

**Retentativa.** O `RetentativaEstornosJob` roda a cada 60 s (respeita `WORKERS_HABILITADOS` e não reentra) e o `RetentarEstornosUseCase` tenta de novo os orçamentos em `ESTORNO_PENDENTE` com a próxima tentativa vencida. O intervalo cresce a cada falha: 1, 5, 15 e 60 minutos (`BACKOFF_ESTORNO_MINUTOS`); da quinta falha em diante continua de hora em hora com o log de erro `billing.estorno.esgotado`, para alguém olhar. Quando uma retentativa dá certo, sai `PagamentoEstornado`. Do lado do orquestrador, `EstornoFalhou` adia o prazo da compensação em vez de reenviar o comando (ver [sequência de compensação](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-os-service/blob/main/docs/arquitetura/sequencia-compensacao.md)).

Erro que não vem do provedor (DynamoDB fora, por exemplo) continua subindo: a mensagem não é apagada, o SQS a reentrega depois do visibility timeout de 60 s e, na quinta entrega, ela vai para a DLQ `oficina-<env>-billing-comandos-dlq`.

## 10. Papel no fluxo da OS

O fluxo da OS é coordenado por uma **Saga orquestrada** (Saga Pattern): um orquestrador central manda comandos e reage aos eventos de cada serviço, e desfaz o que já foi feito com compensações quando algo falha. No código, a Saga se chama `orquestracao-os`, o estado dela é o `FluxoOrdemServico` e o coordenador é o `OrquestradorOrdemServico`, todos no os-service. O billing é **participante**, sem lógica de orquestração.

| Passo da Saga | Comando que o billing recebe | Efeito | Evento |
| --- | --- | --- | --- |
| Gerar orçamento | `GerarOrcamento` | cria o orçamento em `AGUARDANDO_APROVACAO` | `OrcamentoGerado` / `FalhaGerarOrcamento` |
| Compensar: desfazer o orçamento | `CancelarOrcamento` | `AGUARDANDO_APROVACAO` ou `APROVADO` → `CANCELADO` | `OrcamentoCancelado` |
| Compensar: devolver o dinheiro | `EstornarPagamento` | `PAGO` → `ESTORNADO` (sem pagamento registrado, só reemite `PagamentoEstornado` com `pagamentoId` nulo) | `PagamentoEstornado` / `EstornoFalhou` |

A aprovação e a rejeição acontecem por HTTP, pelo cliente, e viram os eventos `OrcamentoAprovado` e `OrcamentoRejeitado`, que o orquestrador consome para avançar. O pagamento chega pelo webhook do Mercado Pago e vira `PagamentoConfirmado`, que libera o reparo. O pagamento é o último passo antes do reparo (contramedida de *visão pessimista*: o reparo só começa com o dinheiro já confirmado).

Para o conjunto da solução, ver no os-service a [visão geral](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-os-service/blob/main/docs/arquitetura/visao-geral-microsservicos.md), a [sequência do fluxo da OS](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-os-service/blob/main/docs/arquitetura/sequencia-fluxo-os.md), a [sequência de compensação](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-os-service/blob/main/docs/arquitetura/sequencia-compensacao.md) e a [ADR 008 (Saga orquestrada)](https://github.com/FIAP-POS-TECH-SOFTWARE-ARCHITECTURE/tc-oficina-os-service/blob/main/docs/arquitetura/adrs/adr-008-saga-orquestrada.md).
