import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvelopeMensagem } from "../../src/modules/mensageria/envelope";
import type { GerarOrcamentoPayload, PayloadComMotivo } from "../../src/modules/orcamentos/application/comandos-billing";
import { type NovoOrcamento, Orcamento } from "../../src/modules/orcamentos/domain/orcamento.entity";

export const CLIENTE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const OUTRO_CLIENTE_ID = "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b";
export const ORCAMENTO_ID = "5d6e7f80-9a0b-4c1d-8e2f-3a4b5c6d7e8f";

const exemplo = <T>(tipo: string) =>
	JSON.parse(readFileSync(join(__dirname, "..", "..", "contratos", "exemplos", `${tipo}.json`), "utf8")) as EnvelopeMensagem<T>;

/** Comando do contrato com messageId novo e prazo de aprovação sempre no futuro. */
type SobrescritaComando = Omit<Partial<EnvelopeMensagem<GerarOrcamentoPayload>>, "payload"> & {
	payload?: Partial<GerarOrcamentoPayload>;
};

export function comandoGerarOrcamento(sobrescrever: SobrescritaComando = {}): EnvelopeMensagem<GerarOrcamentoPayload> {
	const base = exemplo<GerarOrcamentoPayload>("GerarOrcamento");
	const payload = { ...base.payload, prazoAprovacaoEm: new Date(Date.now() + 72 * 3_600_000).toISOString() };
	return { ...base, messageId: randomUUID(), ...sobrescrever, payload: { ...payload, ...sobrescrever.payload } };
}

export function comandoComMotivo(
	tipo: "CancelarOrcamento" | "EstornarPagamento",
	motivo = "PRAZO_PAGAMENTO_EXPIRADO",
	sobrescrever: Partial<EnvelopeMensagem<PayloadComMotivo>> = {},
) {
	return { ...exemplo<PayloadComMotivo>(tipo), messageId: randomUUID(), payload: { motivo }, ...sobrescrever };
}

export function orcamentoNovo(sobrescrever: Partial<NovoOrcamento> = {}, agora = new Date()): Orcamento {
	const c = comandoGerarOrcamento();
	const { cliente, veiculo, itens, valorTotalCentavos, prazoAprovacaoEm, prazoPagamentoMinutos } = c.payload;
	return Orcamento.criar(
		{
			id: ORCAMENTO_ID,
			osId: c.osId,
			numeroOs: c.numeroOs,
			fluxoId: c.fluxoId,
			cliente,
			veiculo,
			itens,
			valorTotalCentavos,
			prazoAprovacaoEm,
			prazoPagamentoMinutos,
			...sobrescrever,
		},
		agora,
	);
}

export const orcamentoPago = (pagamentoId = "1234567890") =>
	orcamentoNovo()
		.aprovar(
			{ linkPagamento: "https://pagamento.simulado.local/checkout/x", preferenciaId: "pref-1" },
			new Date(Date.now() + 3_600_000),
			new Date(),
		)
		.confirmarPagamento({ pagamentoId, valorCentavos: 30000, pagoEm: new Date() }, new Date());
