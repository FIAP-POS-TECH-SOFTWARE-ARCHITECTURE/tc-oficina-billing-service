# language: pt
Funcionalidade: Aprovação do orçamento pelo cliente
  Como cliente da oficina
  Quero aprovar ou rejeitar o orçamento da minha OS
  Para autorizar o reparo e receber o link de pagamento

  Cenário: Cliente aprova o orçamento e recebe o link de pagamento
    Dado que o billing recebeu o comando GerarOrcamento da OS "OS-2026-000123" do cliente "maria" no valor de 30000 centavos
    Quando o cliente "maria" aprova o orçamento da OS "OS-2026-000123"
    Então a resposta tem status 200 com link de pagamento
    E o orçamento da OS "OS-2026-000123" fica com status "APROVADO"
    E o evento "OrcamentoAprovado" é publicado com o mesmo link de pagamento

  Cenário: Cliente rejeita o orçamento
    Dado que o billing recebeu o comando GerarOrcamento da OS "OS-2026-000123" do cliente "maria" no valor de 30000 centavos
    Quando o cliente "maria" rejeita o orçamento da OS "OS-2026-000123" com o motivo "Preço acima do esperado"
    Então a resposta tem status 200
    E o orçamento da OS "OS-2026-000123" fica com status "REJEITADO"
    E o evento "OrcamentoRejeitado" é publicado com o motivo "Preço acima do esperado"

  Cenário: Cliente tenta aprovar orçamento já cancelado pela oficina
    Dado que o billing recebeu o comando GerarOrcamento da OS "OS-2026-000123" do cliente "maria" no valor de 30000 centavos
    E o orquestrador cancelou o orçamento da OS com o motivo "PRAZO_APROVACAO_EXPIRADO"
    Quando o cliente "maria" aprova o orçamento da OS "OS-2026-000123"
    Então a resposta tem status 422
    E o orçamento da OS "OS-2026-000123" fica com status "CANCELADO"
    E nenhum evento "OrcamentoAprovado" é publicado

  Cenário: Outro cliente não consegue aprovar
    Dado que o billing recebeu o comando GerarOrcamento da OS "OS-2026-000123" do cliente "maria" no valor de 30000 centavos
    Quando o cliente "joao" aprova o orçamento da OS "OS-2026-000123"
    Então a resposta tem status 403
    E o orçamento da OS "OS-2026-000123" fica com status "AGUARDANDO_APROVACAO"

  Cenário: Comando GerarOrcamento duplicado não gera segundo orçamento
    Dado que o billing recebeu o comando GerarOrcamento da OS "OS-2026-000123" do cliente "maria" no valor de 30000 centavos
    Quando o mesmo comando GerarOrcamento é entregue de novo
    Então existe 1 orçamento para a OS
    E o evento "OrcamentoGerado" foi publicado 1 vez
