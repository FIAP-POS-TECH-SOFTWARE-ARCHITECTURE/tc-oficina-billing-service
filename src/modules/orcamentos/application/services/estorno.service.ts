import { Inject, Injectable, Logger } from "@nestjs/common";
import { mensagemDeErro } from "../../../../common/utils/erro.util";
import type { Orcamento } from "../../domain/orcamento.entity";
import { type ContextoFluxo, criarEventoBilling } from "../eventos-billing";
import { GATEWAY_PAGAMENTO, type GatewayPagamentoPort, STATUS_PAGAMENTO_ESTORNADO } from "../ports/gateway-pagamento.port";
import { EventosOrcamentoService } from "./eventos-orcamento.service";

export const chaveIdempotenciaEstorno = (orcamentoId: string): string => `estorno-${orcamentoId}`;
export const BACKOFF_ESTORNO_MINUTOS = [1, 5, 15, 60];
export const atrasoRetentativaEstornoMs = (tentativa: number): number =>
	BACKOFF_ESTORNO_MINUTOS[Math.min(Math.max(tentativa, 1), BACKOFF_ESTORNO_MINUTOS.length) - 1] * 60_000;
export type ResultadoEstorno = "ESTORNADO" | "FALHOU";

@Injectable()
export class EstornoService {
	private readonly logger = new Logger(EstornoService.name);

	constructor(
		@Inject(GATEWAY_PAGAMENTO) private readonly pagamentos: GatewayPagamentoPort,
		private readonly eventos: EventosOrcamentoService,
	) {}

	async estornar(orcamento: Orcamento, contexto: ContextoFluxo, mensagemProcessada?: string): Promise<ResultadoEstorno> {
		const pagamentoId = orcamento.pagamentoId as string;
		const agora = new Date();
		try {
			await this.pagamentos.estornar(pagamentoId, chaveIdempotenciaEstorno(orcamento.id));
		} catch (erro) {
			// O reembolso pode ter sido feito por outra chave (ou pelo painel): o que vale é o estado no provedor.
			if (!(await this.jaEstornado(pagamentoId)))
				return this.registrarFalha(orcamento, contexto, mensagemDeErro(erro), agora, mensagemProcessada);
		}
		const evento = criarEventoBilling(contexto, "PagamentoEstornado", {
			orcamentoId: orcamento.id,
			pagamentoId,
			valorCentavos: orcamento.valorPagoCentavos ?? 0,
		});
		await this.eventos.atualizar(orcamento.estornar(agora), orcamento.versao, { mensagemProcessada, eventos: [evento] });
		this.logger.log({
			event: "billing.pagamento.estornado",
			orcamentoId: orcamento.id,
			pagamentoId,
			tentativas: orcamento.tentativasEstorno + 1,
		});
		return "ESTORNADO";
	}

	private async jaEstornado(pagamentoId: string): Promise<boolean> {
		try {
			return (await this.pagamentos.consultarPagamento(pagamentoId))?.status === STATUS_PAGAMENTO_ESTORNADO;
		} catch {
			return false;
		}
	}

	private async registrarFalha(
		orcamento: Orcamento,
		contexto: ContextoFluxo,
		erro: string,
		agora: Date,
		mensagemProcessada?: string,
	): Promise<ResultadoEstorno> {
		const tentativa = orcamento.tentativasEstorno + 1;
		const proximaTentativaEm = new Date(agora.getTime() + atrasoRetentativaEstornoMs(tentativa));
		const evento = criarEventoBilling(contexto, "EstornoFalhou", {
			orcamentoId: orcamento.id,
			pagamentoId: orcamento.pagamentoId as string,
			motivo: erro.slice(0, 2000) || "ERRO_DESCONHECIDO",
			proximaTentativaEm: proximaTentativaEm.toISOString(),
		});
		await this.eventos.atualizar(orcamento.registrarFalhaEstorno(erro, proximaTentativaEm, agora), orcamento.versao, {
			mensagemProcessada,
			eventos: [evento],
		});
		const log = {
			event: "billing.estorno.falhou",
			orcamentoId: orcamento.id,
			pagamentoId: orcamento.pagamentoId,
			tentativa,
			proximaTentativaEm,
			erro,
		};
		// Depois do último degrau do backoff a retentativa continua de hora em hora, mas alguém precisa olhar.
		if (tentativa > BACKOFF_ESTORNO_MINUTOS.length) this.logger.error({ ...log, event: "billing.estorno.esgotado" });
		else this.logger.warn(log);
		return "FALHOU";
	}
}
