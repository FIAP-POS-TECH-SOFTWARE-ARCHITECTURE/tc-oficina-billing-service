import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { EnvelopeMensagem } from "../../../mensageria/envelope";
import { Orcamento, ValorTotalInconsistenteError } from "../../domain/orcamento.entity";
import type { GerarOrcamentoPayload } from "../comandos-billing";
import { contextoDoComando, criarEventoBilling } from "../eventos-billing";
import { ORCAMENTOS_GATEWAY, OrcamentoJaExisteError, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";

@Injectable()
export class GerarOrcamentoUseCase {
	private readonly logger = new Logger(GerarOrcamentoUseCase.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async execute(comando: EnvelopeMensagem<GerarOrcamentoPayload>): Promise<void> {
		if (await this.gateway.mensagemJaProcessada(comando.messageId)) return;
		const contexto = contextoDoComando(comando);
		const responder = (evento: EnvelopeMensagem<unknown>) =>
			this.eventos.registrar({ mensagemProcessada: comando.messageId, eventos: [evento] });

		const cancelamento = await this.gateway.buscarCancelamentoAntecipado(comando.fluxoId);
		if (cancelamento) {
			this.logger.log({ event: "billing.orcamento.fluxo-ja-cancelado", motivo: cancelamento.motivo });
			await responder(criarEventoBilling(contexto, "OrcamentoCancelado", { orcamentoId: null, motivo: cancelamento.motivo }));
			return;
		}

		const existente = await this.gateway.buscarPorOsId(comando.osId);
		if (existente) return this.responderExistente(contexto, existente, responder);

		const { cliente, veiculo, itens, valorTotalCentavos, prazoAprovacaoEm, prazoPagamentoMinutos } = comando.payload;
		let orcamento: Orcamento;
		try {
			orcamento = Orcamento.criar(
				{
					id: randomUUID(),
					osId: comando.osId,
					numeroOs: comando.numeroOs,
					fluxoId: comando.fluxoId,
					cliente,
					veiculo,
					itens,
					valorTotalCentavos,
					prazoAprovacaoEm,
					prazoPagamentoMinutos,
				},
				new Date(),
			);
		} catch (erro) {
			if (!(erro instanceof ValorTotalInconsistenteError)) throw erro;
			this.logger.warn({ event: "billing.orcamento.valor-inconsistente", informado: erro.informado, calculado: erro.calculado });
			await responder(criarEventoBilling(contexto, "FalhaGerarOrcamento", { motivo: "VALOR_TOTAL_INCONSISTENTE" }));
			return;
		}

		const gerado = criarEventoBilling(contexto, "OrcamentoGerado", {
			orcamentoId: orcamento.id,
			valorTotalCentavos: orcamento.valorTotalCentavos,
		});
		try {
			if (await this.eventos.criar(orcamento, { mensagemProcessada: comando.messageId, eventos: [gerado] }))
				this.logger.log({
					event: "billing.orcamento.gerado",
					orcamentoId: orcamento.id,
					valorTotalCentavos: orcamento.valorTotalCentavos,
				});
		} catch (erro) {
			if (!(erro instanceof OrcamentoJaExisteError)) throw erro;
			const concorrente = await this.gateway.buscarPorOsId(comando.osId);
			if (!concorrente) throw erro;
			await this.responderExistente(contexto, concorrente, responder);
		}
	}

	private async responderExistente(
		contexto: ReturnType<typeof contextoDoComando>,
		existente: Orcamento,
		responder: (evento: EnvelopeMensagem<unknown>) => Promise<boolean>,
	): Promise<void> {
		this.logger.log({ event: "billing.orcamento.ja-existente", orcamentoId: existente.id, status: existente.status });
		await responder(
			existente.estaAtivo()
				? criarEventoBilling(contexto, "OrcamentoGerado", {
						orcamentoId: existente.id,
						valorTotalCentavos: existente.valorTotalCentavos,
					})
				: criarEventoBilling(contexto, "FalhaGerarOrcamento", { motivo: "ORCAMENTO_ENCERRADO" }),
		);
	}
}
