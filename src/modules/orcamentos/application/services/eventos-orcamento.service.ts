import { Inject, Injectable, Logger } from "@nestjs/common";
import { mensagemDeErro } from "../../../../common/utils/erro.util";
import { PUBLICADOR_MENSAGENS, type PublicadorMensagensPort } from "../../../mensageria/publicador-mensagens.port";
import { type CabecalhosTrace, capturarCabecalhosTrace } from "../../../mensageria/trace";
import type { Orcamento } from "../../domain/orcamento.entity";
import {
	type CancelamentoAntecipado,
	type EfeitosGravacao,
	type EventoPendente,
	MensagemJaProcessadaError,
	ORCAMENTOS_GATEWAY,
	type OrcamentosGatewayPort,
} from "../ports/orcamentos.gateway";

export const ATRASO_REPUBLICACAO_MS = 10_000;
const LOTE_REPUBLICACAO = 50;

/** Grava efeito + eventos na mesma transação (outbox) e tenta publicar logo em seguida. */
@Injectable()
export class EventosOrcamentoService {
	private readonly logger = new Logger(EventosOrcamentoService.name);

	constructor(
		@Inject(ORCAMENTOS_GATEWAY) private readonly gateway: OrcamentosGatewayPort,
		@Inject(PUBLICADOR_MENSAGENS) private readonly publicador: PublicadorMensagensPort,
	) {}

	criar(orcamento: Orcamento, efeitos: EfeitosGravacao): Promise<boolean> {
		const comTrace = this.comTrace(efeitos);
		return this.gravar(() => this.gateway.criar(orcamento, comTrace), comTrace);
	}

	atualizar(orcamento: Orcamento, versaoAnterior: number, efeitos: EfeitosGravacao): Promise<boolean> {
		const comTrace = this.comTrace(efeitos);
		return this.gravar(() => this.gateway.atualizar(orcamento, versaoAnterior, comTrace), comTrace);
	}

	registrarCancelamentoAntecipado(cancelamento: CancelamentoAntecipado, efeitos: EfeitosGravacao): Promise<boolean> {
		const comTrace = this.comTrace(efeitos);
		return this.gravar(() => this.gateway.registrarCancelamentoAntecipado(cancelamento, comTrace), comTrace);
	}

	registrar(efeitos: EfeitosGravacao): Promise<boolean> {
		const comTrace = this.comTrace(efeitos);
		return this.gravar(() => this.gateway.registrarEfeitos(comTrace), comTrace);
	}

	async publicar(eventos: EventoPendente[]): Promise<void> {
		for (const { envelope: evento, cabecalhosTrace } of eventos) {
			try {
				await this.publicador.publicarEvento(evento, cabecalhosTrace);
				await this.gateway.marcarEventoPublicado(evento.messageId);
				this.logger.log({
					event: "billing.evento.publicado",
					tipo: evento.tipo,
					messageId: evento.messageId,
					fluxoId: evento.fluxoId,
					osId: evento.osId,
				});
			} catch (erro) {
				this.logger.warn({
					event: "billing.evento.publicacao-adiada",
					tipo: evento.tipo,
					messageId: evento.messageId,
					erro: mensagemDeErro(erro),
				});
			}
		}
	}

	async republicarPendentes(agora = new Date()): Promise<number> {
		const pendentes = await this.gateway.listarEventosPendentes(new Date(agora.getTime() - ATRASO_REPUBLICACAO_MS), LOTE_REPUBLICACAO);
		await this.publicar(pendentes);
		return pendentes.length;
	}

	private async gravar(escrita: () => Promise<void>, efeitos: EfeitosGravacao): Promise<boolean> {
		try {
			await escrita();
		} catch (erro) {
			if (!(erro instanceof MensagemJaProcessadaError)) throw erro;
			this.logger.log({ event: "billing.mensagem.duplicada", chave: erro.chave });
			return false;
		}
		const cabecalhosTrace = efeitos.cabecalhosTrace ?? {};
		await this.publicar(efeitos.eventos.map((envelope) => ({ envelope, cabecalhosTrace })));
		return true;
	}

	/** Captura o trace uma única vez, na transação de origem; gravação e publicação imediata usam o mesmo valor. */
	private comTrace(efeitos: EfeitosGravacao): EfeitosGravacao {
		const cabecalhosTrace: CabecalhosTrace = capturarCabecalhosTrace();
		return { ...efeitos, cabecalhosTrace };
	}
}
