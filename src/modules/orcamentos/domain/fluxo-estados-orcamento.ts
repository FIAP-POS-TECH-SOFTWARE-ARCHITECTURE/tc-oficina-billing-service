import { StatusOrcamento as S } from "./status-orcamento";

export type TransicaoOrcamento = "aprovar" | "rejeitar" | "cancelar" | "confirmar_pagamento" | "estornar" | "registrar_falha_estorno";

const TRANSICOES: Record<TransicaoOrcamento, { de: S[]; para: S }> = {
	aprovar: { de: [S.AGUARDANDO_APROVACAO], para: S.APROVADO },
	rejeitar: { de: [S.AGUARDANDO_APROVACAO], para: S.REJEITADO },
	cancelar: { de: [S.AGUARDANDO_APROVACAO, S.APROVADO], para: S.CANCELADO },
	// CANCELADO → PAGO: pagamento que chega depois do cancelamento é registrado; o orquestrador pede o estorno.
	confirmar_pagamento: { de: [S.APROVADO, S.CANCELADO], para: S.PAGO },
	estornar: { de: [S.PAGO, S.ESTORNO_PENDENTE], para: S.ESTORNADO },
	registrar_falha_estorno: { de: [S.PAGO, S.ESTORNO_PENDENTE], para: S.ESTORNO_PENDENTE },
};

export function podeTransicionar(de: S, transicao: TransicaoOrcamento): boolean {
	return TRANSICOES[transicao].de.includes(de);
}

export function proximoStatus(transicao: TransicaoOrcamento): S {
	return TRANSICOES[transicao].para;
}
