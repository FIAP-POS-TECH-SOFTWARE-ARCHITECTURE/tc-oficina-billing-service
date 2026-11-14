# language: pt
Funcionalidade: Pagamento do orçamento pelo Mercado Pago e estorno
  Como oficina
  Quero confirmar pagamentos só depois de consultar o Mercado Pago e estornar quando a OS for cancelada
  Para nunca iniciar reparo sem pagamento nem deixar cliente cobrado por OS cancelada

  Cenário: Pagamento aprovado confirma o orçamento
    Dado um orçamento aprovado de 30000 centavos da OS "OS-2026-000123"
    E o Mercado Pago registrou o pagamento "9001" como "approved" no valor de 30000 centavos
    Quando chega a notificação do pagamento "9001"
    Então o orçamento fica com status "PAGO"
    E o evento "PagamentoConfirmado" é publicado 1 vez com o pagamento "9001"

  Cenário: Notificação repetida não confirma duas vezes
    Dado um orçamento aprovado de 30000 centavos da OS "OS-2026-000123"
    E o Mercado Pago registrou o pagamento "9001" como "approved" no valor de 30000 centavos
    Quando chega a notificação do pagamento "9001"
    E chega a notificação do pagamento "9001"
    Então o evento "PagamentoConfirmado" é publicado 1 vez com o pagamento "9001"

  Cenário: Pagamento pendente não confirma nada
    Dado um orçamento aprovado de 30000 centavos da OS "OS-2026-000123"
    E o Mercado Pago registrou o pagamento "9002" como "pending" no valor de 30000 centavos
    Quando chega a notificação do pagamento "9002"
    Então o orçamento fica com status "APROVADO"
    E nenhum evento "PagamentoConfirmado" é publicado

  Cenário: Pagamento que chega depois do cancelamento é confirmado para a saga estornar
    Dado um orçamento aprovado de 30000 centavos da OS "OS-2026-000123"
    E o orquestrador cancelou o orçamento com o motivo "PRAZO_PAGAMENTO_EXPIRADO"
    E o Mercado Pago registrou o pagamento "9003" como "approved" no valor de 30000 centavos
    Quando chega a notificação do pagamento "9003"
    Então o orçamento fica com status "PAGO"
    E o evento "PagamentoConfirmado" é publicado 1 vez com o pagamento "9003"
    Quando o orquestrador pede o estorno do pagamento
    Então o orçamento fica com status "ESTORNADO"
    E o evento "PagamentoEstornado" é publicado com valor 30000

  Cenário: Estorno falha e é retentado
    Dado um orçamento pago de 30000 centavos com o pagamento "9004"
    E o Mercado Pago está recusando estornos
    Quando o orquestrador pede o estorno do pagamento
    Então o orçamento fica com status "ESTORNO_PENDENTE"
    E o evento "EstornoFalhou" é publicado com próxima tentativa em 1 minuto
    Quando o Mercado Pago volta a aceitar estornos
    E a retentativa de estornos roda 2 minutos depois
    Então o orçamento fica com status "ESTORNADO"
    E o evento "PagamentoEstornado" é publicado com valor 30000

  Cenário: Pagamento com valor diferente do orçamento é estornado direto
    Dado um orçamento aprovado de 30000 centavos da OS "OS-2026-000123"
    E o Mercado Pago registrou o pagamento "9005" como "approved" no valor de 100 centavos
    Quando chega a notificação do pagamento "9005"
    Então o orçamento fica com status "APROVADO"
    E o pagamento "9005" foi estornado no Mercado Pago
    E nenhum evento "PagamentoConfirmado" é publicado
