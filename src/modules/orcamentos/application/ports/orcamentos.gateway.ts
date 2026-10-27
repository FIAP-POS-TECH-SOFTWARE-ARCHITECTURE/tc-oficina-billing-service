import type { EnvelopeMensagem } from "../../../mensageria/envelope";
import type { Orcamento } from "../../domain/orcamento.entity";
import type { StatusOrcamento } from "../../domain/status-orcamento";
import type { PagamentoExterno } from "./gateway-pagamento.port";

export const ORCAMENTOS_GATEWAY = Symbol("ORCAMENTOS_GATEWAY");

export interface CancelamentoAntecipado {
	fluxoId: string;
	osId: string;
	motivo: string;
	canceladoEm: string;
}

/** Tudo o que é gravado na mesma transação do efeito de domínio. */
export interface EfeitosGravacao {
	/** messageId do comando → item MSG# */
	mensagemProcessada?: string;
	/** "<pagamentoId>#<status>" → item WEBHOOK# */
	notificacaoProcessada?: string;
	/** itens PAGAMENTO# */
	pagamentos?: PagamentoExterno[];
	eventos: EnvelopeMensagem<unknown>[];
}

export class MensagemJaProcessadaError extends Error {
	constructor(readonly chave: string) {
		super(`Mensagem ${chave} já processada`);
		this.name = "MensagemJaProcessadaError";
	}
}

export class ConflitoConcorrenciaError extends Error {
	constructor(readonly referencia: string) {
		super(`Registro ${referencia} mudou entre a leitura e a escrita`);
		this.name = "ConflitoConcorrenciaError";
	}
}

export class OrcamentoJaExisteError extends Error {
	constructor(readonly osId: string) {
		super(`Já existe orçamento para a OS ${osId}`);
		this.name = "OrcamentoJaExisteError";
	}
}

export interface OrcamentosGatewayPort {
	buscarPorId(orcamentoId: string): Promise<Orcamento | null>;
	buscarPorOsId(osId: string): Promise<Orcamento | null>;
	buscarPorNumeroOs(numeroOs: string): Promise<Orcamento | null>;
	listarPorStatus(status: StatusOrcamento): Promise<Orcamento[]>;
	buscarCancelamentoAntecipado(fluxoId: string): Promise<CancelamentoAntecipado | null>;
	mensagemJaProcessada(messageId: string): Promise<boolean>;
	notificacaoJaProcessada(chave: string): Promise<boolean>;
	/** OrcamentoJaExisteError | ConflitoConcorrenciaError | MensagemJaProcessadaError */
	criar(orcamento: Orcamento, efeitos: EfeitosGravacao): Promise<void>;
	/** ConflitoConcorrenciaError | MensagemJaProcessadaError */
	atualizar(orcamento: Orcamento, versaoAnterior: number, efeitos: EfeitosGravacao): Promise<void>;
	/** ConflitoConcorrenciaError | MensagemJaProcessadaError */
	registrarCancelamentoAntecipado(cancelamento: CancelamentoAntecipado, efeitos: EfeitosGravacao): Promise<void>;
	/** MensagemJaProcessadaError */
	registrarEfeitos(efeitos: EfeitosGravacao): Promise<void>;
	listarEventosPendentes(ocorridosAntesDe: Date, limite: number): Promise<EnvelopeMensagem<unknown>[]>;
	marcarEventoPublicado(messageId: string): Promise<void>;
}
