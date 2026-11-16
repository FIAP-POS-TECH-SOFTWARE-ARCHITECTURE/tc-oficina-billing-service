import { Injectable } from "@nestjs/common";
import {
	type CobrancaCriada,
	type DadosCobranca,
	ErroGatewayPagamento,
	type EstornoRealizado,
	type GatewayPagamentoPort,
	type PagamentoExterno,
	STATUS_PAGAMENTO_ESTORNADO,
} from "../../application/ports/gateway-pagamento.port";

/** Cobrança simulada: usada nos testes e até o Mercado Pago ser ligado. Não movimenta dinheiro. */
@Injectable()
export class GatewayPagamentoSimulado implements GatewayPagamentoPort {
	private readonly pagamentos = new Map<string, PagamentoExterno>();
	private readonly estornos = new Map<string, EstornoRealizado>();
	falharEstornos = false;

	criarCobranca(dados: DadosCobranca): Promise<CobrancaCriada> {
		return Promise.resolve({
			preferenciaId: `simulada-${dados.orcamentoId}`,
			linkPagamento: `https://pagamento.simulado.local/checkout/${dados.orcamentoId}`,
		});
	}

	registrarPagamento(pagamento: PagamentoExterno): void {
		this.pagamentos.set(pagamento.pagamentoId, pagamento);
	}

	consultarPagamento(pagamentoId: string): Promise<PagamentoExterno | null> {
		return Promise.resolve(this.pagamentos.get(pagamentoId) ?? null);
	}

	buscarPagamentosPorOrcamento(orcamentoId: string): Promise<PagamentoExterno[]> {
		return Promise.resolve([...this.pagamentos.values()].filter((p) => p.orcamentoId === orcamentoId));
	}

	estornar(pagamentoId: string, chaveIdempotencia: string): Promise<EstornoRealizado> {
		if (this.falharEstornos) return Promise.reject(new ErroGatewayPagamento("Estorno recusado (simulado)", true, 503));
		const anterior = this.estornos.get(chaveIdempotencia);
		if (anterior) return Promise.resolve(anterior);
		const pagamento = this.pagamentos.get(pagamentoId);
		const estorno = { estornoId: `estorno-${pagamentoId}`, valorCentavos: pagamento?.valorCentavos ?? 0 };
		this.estornos.set(chaveIdempotencia, estorno);
		if (pagamento) this.pagamentos.set(pagamentoId, { ...pagamento, status: STATUS_PAGAMENTO_ESTORNADO });
		return Promise.resolve(estorno);
	}
}
