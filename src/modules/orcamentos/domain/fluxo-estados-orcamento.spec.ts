import { podeTransicionar, proximoStatus, type TransicaoOrcamento } from "./fluxo-estados-orcamento";
import { StatusOrcamento as S } from "./status-orcamento";

const T: TransicaoOrcamento[] = ["aprovar", "rejeitar", "cancelar", "confirmar_pagamento", "estornar", "registrar_falha_estorno"];
// Uma linha por status, uma coluna por transição (mesma ordem de T); null = proibida.
const MATRIZ: Record<S, (S | null)[]> = {
	[S.AGUARDANDO_APROVACAO]: [S.APROVADO, S.REJEITADO, S.CANCELADO, null, null, null],
	[S.APROVADO]: [null, null, S.CANCELADO, S.PAGO, null, null],
	[S.REJEITADO]: [null, null, null, null, null, null],
	[S.CANCELADO]: [null, null, null, S.PAGO, null, null],
	[S.PAGO]: [null, null, null, null, S.ESTORNADO, S.ESTORNO_PENDENTE],
	[S.ESTORNO_PENDENTE]: [null, null, null, null, S.ESTORNADO, S.ESTORNO_PENDENTE],
	[S.ESTORNADO]: [null, null, null, null, null, null],
};
const CELULAS = Object.values(S).flatMap((de) => T.map((t, i) => [de, t, MATRIZ[de][i]] as const));

describe("máquina de estados do orçamento", () => {
	it("cobre as 42 células", () => expect(CELULAS).toHaveLength(42));

	it.each(CELULAS)("%s + %s → %s", (de, transicao, para) => {
		expect(podeTransicionar(de, transicao)).toBe(para !== null);
		if (para) expect(proximoStatus(transicao)).toBe(para);
	});
});
