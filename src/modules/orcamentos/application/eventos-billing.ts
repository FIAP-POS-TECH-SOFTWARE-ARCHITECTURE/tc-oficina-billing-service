import { criarEnvelope, type EnvelopeMensagem } from "../../mensageria/envelope";
import type { Orcamento } from "../domain/orcamento.entity";

export type TipoEventoBilling =
	| "OrcamentoGerado"
	| "FalhaGerarOrcamento"
	| "OrcamentoAprovado"
	| "OrcamentoRejeitado"
	| "OrcamentoCancelado"
	| "PagamentoConfirmado"
	| "PagamentoEstornado"
	| "EstornoFalhou";

export interface ContextoFluxo {
	fluxoId: string;
	osId: string;
	numeroOs: string;
	correlationId: string;
}

export const contextoDoComando = (c: EnvelopeMensagem<unknown>): ContextoFluxo => ({
	fluxoId: c.fluxoId,
	osId: c.osId,
	numeroOs: c.numeroOs,
	correlationId: c.correlationId,
});

export const contextoDoOrcamento = (o: Orcamento, correlationId: string): ContextoFluxo => ({
	fluxoId: o.fluxoId,
	osId: o.osId,
	numeroOs: o.numeroOs,
	correlationId,
});

export function criarEventoBilling<T>(contexto: ContextoFluxo, tipo: TipoEventoBilling, payload: T): EnvelopeMensagem<T> {
	return criarEnvelope({ ...contexto, tipo, origem: "billing", payload });
}
