import { Inject, Injectable, Logger } from "@nestjs/common";
import { podeTransicionar } from "../../domain/fluxo-estados-orcamento";
import type { Orcamento } from "../../domain/orcamento.entity";
import { contextoDoOrcamento, criarEventoBilling } from "../eventos-billing";
import {
	GATEWAY_PAGAMENTO,
	type GatewayPagamentoPort,
	type PagamentoExterno,
	STATUS_PAGAMENTO_APROVADO,
} from "../ports/gateway-pagamento.port";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";

export type ResultadoRegistroPagamento =
	| "CONFIRMADO"
	| "CONFIRMADO_ATRASADO"
	| "JA_REGISTRADO"
	| "NAO_APROVADO"
	| "SEM_ORCAMENTO"
	| "ESTORNADO_VALOR_DIVERGENTE"
	| "ESTORNADO_DUPLICADO"
	| "ESTORNADO_NAO_APLICAVEL"
	| "PAGAMENTO_NAO_ENCONTRADO";

@Injectable()
export class RegistrarPagamentoUseCase {
	private readonly logger = new Logger(RegistrarPagamentoUseCase.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		@Inject(GATEWAY_PAGAMENTO) private readonly pagamentos: GatewayPagamentoPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async execute(pagamento: PagamentoExterno, correlationId: string): Promise<ResultadoRegistroPagamento> {
		// Só pagamento aprovado muda o orçamento; o reembolso feito por nós mesmos também chega aqui e é ignorado.
		if (pagamento.status !== STATUS_PAGAMENTO_APROVADO) return "NAO_APROVADO";

		const orcamento = pagamento.orcamentoId ? await this.gateway.buscarPorId(pagamento.orcamentoId) : null;
		if (!orcamento) {
			this.logger.error({
				event: "billing.pagamento.sem-orcamento",
				pagamentoId: pagamento.pagamentoId,
				externalReference: pagamento.orcamentoId,
			});
			return "SEM_ORCAMENTO";
		}

		const chave = `${pagamento.pagamentoId}#${pagamento.status}`;
		if (orcamento.pagamentoId === pagamento.pagamentoId || (await this.gateway.notificacaoJaProcessada(chave))) return "JA_REGISTRADO";

		if (orcamento.possuiPagamento()) return this.estornarDireto(orcamento, pagamento, chave, "duplicado", "ESTORNADO_DUPLICADO");
		if (pagamento.valorCentavos !== orcamento.valorTotalCentavos)
			return this.estornarDireto(orcamento, pagamento, chave, "divergente", "ESTORNADO_VALOR_DIVERGENTE");
		if (!podeTransicionar(orcamento.status, "confirmar_pagamento"))
			return this.estornarDireto(orcamento, pagamento, chave, "nao-aplicavel", "ESTORNADO_NAO_APLICAVEL");

		const pagoEm = new Date(pagamento.pagoEm ?? Date.now());
		const pago = orcamento.confirmarPagamento(
			{ pagamentoId: pagamento.pagamentoId, valorCentavos: pagamento.valorCentavos, pagoEm },
			new Date(),
		);
		const evento = criarEventoBilling(contextoDoOrcamento(orcamento, correlationId), "PagamentoConfirmado", {
			orcamentoId: orcamento.id,
			pagamentoId: pagamento.pagamentoId,
			valorCentavos: pagamento.valorCentavos,
			pagoEm: pagoEm.toISOString(),
		});
		const gravado = await this.eventos.atualizar(pago, orcamento.versao, {
			notificacaoProcessada: chave,
			pagamentos: [pagamento],
			eventos: [evento],
		});
		if (!gravado) return "JA_REGISTRADO";

		const campos = { orcamentoId: orcamento.id, pagamentoId: pagamento.pagamentoId, fluxoId: orcamento.fluxoId, osId: orcamento.osId };
		if (pago.pagamentoAtrasado) {
			this.logger.warn({ event: "billing.pagamento.atrasado", ...campos });
			return "CONFIRMADO_ATRASADO";
		}
		this.logger.log({ event: "billing.pagamento.confirmado", ...campos });
		return "CONFIRMADO";
	}

	/** Pagamento que o orquestrador não tem como tratar: devolve o dinheiro na hora e só registra a notificação. */
	private async estornarDireto(
		orcamento: Orcamento,
		pagamento: PagamentoExterno,
		chave: string,
		motivo: string,
		resultado: ResultadoRegistroPagamento,
	): Promise<ResultadoRegistroPagamento> {
		this.logger.error({
			event: `billing.pagamento.${motivo}`,
			orcamentoId: orcamento.id,
			status: orcamento.status,
			pagamentoId: pagamento.pagamentoId,
			valorCentavos: pagamento.valorCentavos,
		});
		await this.pagamentos.estornar(pagamento.pagamentoId, `estorno-${motivo}-${pagamento.pagamentoId}`);
		await this.eventos.registrar({
			notificacaoProcessada: chave,
			pagamentos: [{ ...pagamento, orcamentoId: orcamento.id }],
			eventos: [],
		});
		return resultado;
	}
}
