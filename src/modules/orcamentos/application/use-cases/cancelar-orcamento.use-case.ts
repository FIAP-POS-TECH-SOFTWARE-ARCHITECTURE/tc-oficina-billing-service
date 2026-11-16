import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EnvelopeMensagem } from "../../../mensageria/envelope";
import { podeTransicionar } from "../../domain/fluxo-estados-orcamento";
import type { PayloadComMotivo } from "../comandos-billing";
import { contextoDoComando, criarEventoBilling } from "../eventos-billing";
import { ORCAMENTOS_GATEWAY, type OrcamentosGatewayPort } from "../ports/orcamentos.gateway";
import { EventosOrcamentoService } from "../services/eventos-orcamento.service";

@Injectable()
export class CancelarOrcamentoUseCase {
	private readonly logger = new Logger(CancelarOrcamentoUseCase.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async execute(comando: EnvelopeMensagem<PayloadComMotivo>): Promise<void> {
		if (await this.gateway.mensagemJaProcessada(comando.messageId)) return;
		const contexto = contextoDoComando(comando);
		const { motivo } = comando.payload;
		const agora = new Date();

		const orcamento = await this.gateway.buscarPorOsId(comando.osId);
		if (!orcamento) {
			// Contrato §2 regra 4: cancelamento antes do GerarOrcamento (SQS não ordena).
			const evento = criarEventoBilling(contexto, "OrcamentoCancelado", { orcamentoId: null, motivo });
			await this.eventos.registrarCancelamentoAntecipado(
				{ fluxoId: comando.fluxoId, osId: comando.osId, motivo, canceladoEm: agora.toISOString() },
				{ mensagemProcessada: comando.messageId, eventos: [evento] },
			);
			this.logger.log({ event: "billing.orcamento.cancelado-antecipadamente", motivo });
			return;
		}

		const evento = criarEventoBilling(contexto, "OrcamentoCancelado", { orcamentoId: orcamento.id, motivo });
		const efeitos = { mensagemProcessada: comando.messageId, eventos: [evento] };
		const atualizado = podeTransicionar(orcamento.status, "cancelar")
			? orcamento.cancelar(motivo, agora)
			: orcamento.registrarCancelamentoSemMudarStatus(motivo, agora);

		if (atualizado === orcamento) await this.eventos.registrar(efeitos);
		else await this.eventos.atualizar(atualizado, orcamento.versao, efeitos);
		this.logger.log({ event: "billing.orcamento.cancelado", orcamentoId: orcamento.id, status: atualizado.status, motivo });
	}
}
