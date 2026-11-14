import type { OrderResponse } from "mercadopago/dist/clients/order/commonTypes";
import { mensagemDeErro } from "../../../../../common/utils/erro.util";
import {
	type CobrancaCriada,
	type DadosCobranca,
	ErroGatewayPagamento,
	type EstornoRealizado,
	type GatewayPagamentoPort,
	type PagamentoExterno,
	STATUS_PAGAMENTO_APROVADO,
} from "../../../application/ports/gateway-pagamento.port";
import type { ClientesMercadoPago } from "./clientes-mercado-pago";
import { centavosParaDecimal, decimalParaCentavos, duracaoAte, statusDaOrder } from "./conversao-valores";

export const JANELA_BUSCA_DIAS = 28; // a API limita a busca a 1 mês
const OPCOES_CONSULTA = { timeout: 5_000, maxRetries: 1 };
const DIA_MS = 24 * 60 * 60_000;

const paraPagamentoExterno = (o: OrderResponse): PagamentoExterno => {
	const status = statusDaOrder(o.status, o.status_detail);
	return {
		pagamentoId: String(o.id),
		status,
		orcamentoId: o.external_reference ?? null,
		valorCentavos: decimalParaCentavos(o.total_paid_amount),
		pagoEm: status === STATUS_PAGAMENTO_APROVADO ? (o.last_updated_date ?? null) : null,
		bruto: {
			id: o.id,
			status: o.status,
			status_detail: o.status_detail,
			external_reference: o.external_reference,
			total_amount: o.total_amount,
			total_paid_amount: o.total_paid_amount,
			created_date: o.created_date,
			last_updated_date: o.last_updated_date,
			pagamentos: o.transactions?.payments?.map((p) => ({
				id: p.id,
				status: p.status,
				status_detail: p.status_detail,
				paid_amount: p.paid_amount,
				refunded_amount: p.refunded_amount,
				payment_method: p.payment_method?.id,
			})),
			reembolsos: o.transactions?.refunds?.map((r) => ({ id: r.id, status: r.status, amount: r.amount })),
		},
	};
};

const statusHttp = (erro: unknown): number | undefined => (erro as { status?: number } | undefined)?.status || undefined;

// O SDK transforma todo 409 em MPIdempotencyError; o código do erro só aparece na mensagem.
const chaveJaUsada = (erro: unknown): boolean =>
	statusHttp(erro) === 409 && mensagemDeErro(erro).includes("idempotency_key_already_used");

function traduzir(erro: unknown, operacao: string): ErroGatewayPagamento {
	if (erro instanceof ErroGatewayPagamento) return erro;
	if (erro instanceof RangeError) return new ErroGatewayPagamento(`Mercado Pago: ${operacao}: ${erro.message}`, false);
	const status = statusHttp(erro);
	const temporario = status === undefined || status === 429 || status >= 500;
	return new ErroGatewayPagamento(
		`Mercado Pago: falha ao ${operacao}${status ? ` (HTTP ${status})` : ""}: ${mensagemDeErro(erro)}`,
		temporario,
		status,
	);
}

export class MercadoPagoGateway implements GatewayPagamentoPort {
	constructor(
		private readonly mp: ClientesMercadoPago,
		private readonly agora: () => Date = () => new Date(),
	) {}

	async criarCobranca(dados: DadosCobranca): Promise<CobrancaCriada> {
		try {
			const somaItens = dados.itens.reduce((total, item) => total + item.precoUnitarioCentavos * item.quantidade, 0);
			// A API recusa a order quando total_amount ≠ Σ unit_price × quantity; melhor falhar aqui, com mensagem clara.
			if (somaItens !== dados.valorTotalCentavos)
				throw new ErroGatewayPagamento(
					`Mercado Pago: soma dos itens (${somaItens}) difere do total (${dados.valorTotalCentavos})`,
					false,
				);
			const urlNotificacao = process.env.MERCADO_PAGO_NOTIFICATION_URL || undefined;
			const r = await this.mp.orders.create({
				body: {
					type: "online",
					processing_mode: "manual",
					capture_mode: "automatic",
					external_reference: dados.orcamentoId,
					description: `Orçamento da OS ${dados.numeroOs}`.slice(0, 256),
					total_amount: centavosParaDecimal(somaItens),
					items: dados.itens.map((item) => ({
						external_code: item.referenciaId,
						title: item.descricao.slice(0, 256),
						quantity: item.quantidade,
						unit_price: centavosParaDecimal(item.precoUnitarioCentavos),
					})),
					// Expira junto com o prazo de pagamento da orquestração; meios offline ficam de fora porque podem aprovar depois.
					expiration_time: duracaoAte(dados.expiraEm, this.agora()),
					config: {
						statement_descriptor: "OFICINA",
						payment_method: { not_allowed_types: ["ticket", "atm"], max_installments: 1 },
						online: { retries: { allowed: true }, ...(urlNotificacao ? { callback_url: urlNotificacao } : {}) },
					},
				},
				requestOptions: { idempotencyKey: `order-${dados.orcamentoId}` },
			});
			if (!r.id || !r.checkout_url) throw new ErroGatewayPagamento("Mercado Pago: order sem id ou checkout_url", false);
			return { preferenciaId: r.id, linkPagamento: r.checkout_url };
		} catch (erro) {
			if (chaveJaUsada(erro)) return this.reaproveitarOrder(dados.orcamentoId);
			throw traduzir(erro, "criar order");
		}
	}

	/** A chave de idempotência é fixa por orçamento; numa retentativa o body muda (expiration_time) e o MP responde 409. */
	private async reaproveitarOrder(orcamentoId: string): Promise<CobrancaCriada> {
		try {
			const [existente] = await this.buscarPagamentosPorOrcamento(orcamentoId);
			// A busca indexa com alguns segundos de atraso: vazia aqui significa "tente de novo", não "não existe".
			if (!existente)
				throw new ErroGatewayPagamento("Mercado Pago: order já criada para o orçamento, mas ainda não aparece na busca", true);
			const order = await this.mp.orders.get({ id: existente.pagamentoId, requestOptions: OPCOES_CONSULTA });
			if (!order.id || !order.checkout_url) throw new ErroGatewayPagamento("Mercado Pago: order existente sem checkout_url", true);
			return { preferenciaId: order.id, linkPagamento: order.checkout_url };
		} catch (erro) {
			throw traduzir(erro, "reaproveitar order");
		}
	}

	async consultarPagamento(pagamentoId: string): Promise<PagamentoExterno | null> {
		try {
			return paraPagamentoExterno(await this.mp.orders.get({ id: pagamentoId, requestOptions: OPCOES_CONSULTA }));
		} catch (erro) {
			if (statusHttp(erro) === 404) return null;
			throw traduzir(erro, "consultar order");
		}
	}

	async buscarPagamentosPorOrcamento(orcamentoId: string): Promise<PagamentoExterno[]> {
		try {
			const fim = this.agora();
			const r = await this.mp.orders.search({
				options: {
					begin_date: new Date(fim.getTime() - JANELA_BUSCA_DIAS * DIA_MS).toISOString(),
					end_date: fim.toISOString(),
					external_reference: orcamentoId,
					sort_by: "created_date",
					sort_order: "desc",
				},
			});
			return (r.data ?? []).map(paraPagamentoExterno);
		} catch (erro) {
			throw traduzir(erro, "buscar orders");
		}
	}

	async estornar(pagamentoId: string, chaveIdempotencia: string): Promise<EstornoRealizado> {
		try {
			// Sem body = reembolso total da order.
			const r = await this.mp.orders.refund({ id: pagamentoId, requestOptions: { idempotencyKey: chaveIdempotencia } });
			const reembolsos = r.transactions?.refunds ?? [];
			return {
				estornoId: String(reembolsos.at(-1)?.id ?? ""),
				valorCentavos: reembolsos.reduce((total, x) => total + decimalParaCentavos(x.amount), 0),
			};
		} catch (erro) {
			throw traduzir(erro, "reembolsar order");
		}
	}
}
