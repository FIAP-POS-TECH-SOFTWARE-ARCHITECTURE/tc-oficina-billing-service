import { DomainError } from "../../../common/domain/domain-error";
import { podeTransicionar, proximoStatus, type TransicaoOrcamento } from "./fluxo-estados-orcamento";
import { StatusOrcamento } from "./status-orcamento";

export type TipoItemOrcamento = "SERVICO" | "INSUMO";
export interface ItemOrcamento {
	tipo: TipoItemOrcamento;
	referenciaId: string;
	descricao: string;
	quantidade: number;
	precoUnitarioCentavos: number;
}
export interface ClienteOrcamento {
	id: string;
	nome: string;
	email: string | null;
	documento: string;
}
export interface VeiculoOrcamento {
	placa: string;
	marca: string;
	modelo: string;
}

export interface NovoOrcamento {
	id: string;
	osId: string;
	numeroOs: string;
	fluxoId: string;
	cliente: ClienteOrcamento;
	veiculo: VeiculoOrcamento;
	itens: ItemOrcamento[];
	valorTotalCentavos: number;
	prazoAprovacaoEm: string;
	prazoPagamentoMinutos: number;
}

export interface DadosOrcamento extends NovoOrcamento {
	status: StatusOrcamento;
	versao: number;
	criadoEm: string;
	atualizadoEm: string;
	aprovadoEm: string | null;
	prazoPagamentoEm: string | null;
	linkPagamento: string | null;
	preferenciaId: string | null;
	rejeitadoEm: string | null;
	motivoRejeicao: string | null;
	canceladoEm: string | null;
	motivoCancelamento: string | null;
	pagamentoId: string | null;
	valorPagoCentavos: number | null;
	pagoEm: string | null;
	pagamentoAtrasado: boolean;
	estornadoEm: string | null;
	tentativasEstorno: number;
	proximaTentativaEstornoEm: string | null;
	ultimoErroEstorno: string | null;
}

export class TransicaoInvalidaError extends DomainError {
	constructor(
		readonly status: StatusOrcamento,
		readonly transicao: TransicaoOrcamento,
	) {
		super(`Transição "${transicao}" inválida para orçamento em ${status}`);
		this.name = "TransicaoInvalidaError";
	}
}

export class ValorTotalInconsistenteError extends DomainError {
	constructor(
		readonly informado: number,
		readonly calculado: number,
	) {
		super(`valorTotalCentavos ${informado} difere da soma dos itens (${calculado})`);
		this.name = "ValorTotalInconsistenteError";
	}
}

const ATIVOS = [StatusOrcamento.AGUARDANDO_APROVACAO, StatusOrcamento.APROVADO, StatusOrcamento.PAGO];
const COM_PAGAMENTO = [StatusOrcamento.PAGO, StatusOrcamento.ESTORNO_PENDENTE, StatusOrcamento.ESTORNADO];

export const somarItensCentavos = (itens: ItemOrcamento[]): number =>
	itens.reduce((total, item) => total + item.quantidade * item.precoUnitarioCentavos, 0);

export class Orcamento {
	private constructor(private readonly dados: Readonly<DadosOrcamento>) {}

	static criar(novo: NovoOrcamento, agora: Date): Orcamento {
		const calculado = somarItensCentavos(novo.itens);
		if (!Number.isSafeInteger(calculado) || calculado !== novo.valorTotalCentavos)
			throw new ValorTotalInconsistenteError(novo.valorTotalCentavos, calculado);
		const iso = agora.toISOString();
		return new Orcamento({
			...novo,
			cliente: { ...novo.cliente },
			veiculo: { ...novo.veiculo },
			itens: novo.itens.map((item) => ({ ...item })),
			status: StatusOrcamento.AGUARDANDO_APROVACAO,
			versao: 1,
			criadoEm: iso,
			atualizadoEm: iso,
			aprovadoEm: null,
			prazoPagamentoEm: null,
			linkPagamento: null,
			preferenciaId: null,
			rejeitadoEm: null,
			motivoRejeicao: null,
			canceladoEm: null,
			motivoCancelamento: null,
			pagamentoId: null,
			valorPagoCentavos: null,
			pagoEm: null,
			pagamentoAtrasado: false,
			estornadoEm: null,
			tentativasEstorno: 0,
			proximaTentativaEstornoEm: null,
			ultimoErroEstorno: null,
		});
	}

	static restaurar(dados: DadosOrcamento): Orcamento {
		return new Orcamento({ ...dados, itens: dados.itens.map((item) => ({ ...item })) });
	}

	paraDados(): DadosOrcamento {
		return {
			...this.dados,
			cliente: { ...this.dados.cliente },
			veiculo: { ...this.dados.veiculo },
			itens: this.dados.itens.map((i) => ({ ...i })),
		};
	}

	get id() {
		return this.dados.id;
	}
	get osId() {
		return this.dados.osId;
	}
	get numeroOs() {
		return this.dados.numeroOs;
	}
	get fluxoId() {
		return this.dados.fluxoId;
	}
	get status() {
		return this.dados.status;
	}
	get versao() {
		return this.dados.versao;
	}
	get criadoEm() {
		return this.dados.criadoEm;
	}
	get itens() {
		return this.dados.itens.map((item) => ({ ...item }));
	}
	get valorTotalCentavos() {
		return this.dados.valorTotalCentavos;
	}
	get prazoPagamentoMinutos() {
		return this.dados.prazoPagamentoMinutos;
	}
	get linkPagamento() {
		return this.dados.linkPagamento;
	}
	get prazoPagamentoEm() {
		return this.dados.prazoPagamentoEm;
	}
	get pagamentoId() {
		return this.dados.pagamentoId;
	}
	get valorPagoCentavos() {
		return this.dados.valorPagoCentavos;
	}
	get pagamentoAtrasado() {
		return this.dados.pagamentoAtrasado;
	}
	get canceladoEm() {
		return this.dados.canceladoEm;
	}
	get tentativasEstorno() {
		return this.dados.tentativasEstorno;
	}
	get proximaTentativaEstornoEm() {
		return this.dados.proximaTentativaEstornoEm;
	}

	pertenceAoCliente(clienteId: string): boolean {
		return this.dados.cliente.id === clienteId;
	}

	estaAtivo(): boolean {
		return ATIVOS.includes(this.dados.status);
	}

	possuiPagamento(): boolean {
		return this.dados.pagamentoId !== null;
	}

	prazoAprovacaoExpirado(agora: Date): boolean {
		return agora.getTime() > new Date(this.dados.prazoAprovacaoEm).getTime();
	}

	aprovar(cobranca: { linkPagamento: string; preferenciaId: string }, prazoPagamentoEm: Date, agora: Date): Orcamento {
		return this.transicionar("aprovar", agora, {
			aprovadoEm: agora.toISOString(),
			prazoPagamentoEm: prazoPagamentoEm.toISOString(),
			linkPagamento: cobranca.linkPagamento,
			preferenciaId: cobranca.preferenciaId,
		});
	}

	rejeitar(motivo: string | null, agora: Date): Orcamento {
		return this.transicionar("rejeitar", agora, { rejeitadoEm: agora.toISOString(), motivoRejeicao: motivo });
	}

	cancelar(motivo: string, agora: Date): Orcamento {
		return this.transicionar("cancelar", agora, { canceladoEm: agora.toISOString(), motivoCancelamento: motivo });
	}

	/** Cancelamento pedido pela saga quando já houve pagamento: o status reflete o dinheiro; o estorno vem por EstornarPagamento. */
	registrarCancelamentoSemMudarStatus(motivo: string, agora: Date): Orcamento {
		if (this.dados.canceladoEm !== null || !COM_PAGAMENTO.includes(this.dados.status)) return this;
		return new Orcamento({
			...this.dados,
			canceladoEm: agora.toISOString(),
			motivoCancelamento: motivo,
			versao: this.dados.versao + 1,
			atualizadoEm: agora.toISOString(),
		});
	}

	confirmarPagamento(pagamento: { pagamentoId: string; valorCentavos: number; pagoEm: Date }, agora: Date): Orcamento {
		return this.transicionar("confirmar_pagamento", agora, {
			pagamentoId: pagamento.pagamentoId,
			valorPagoCentavos: pagamento.valorCentavos,
			pagoEm: pagamento.pagoEm.toISOString(),
			pagamentoAtrasado: this.dados.status === StatusOrcamento.CANCELADO,
		});
	}

	estornar(agora: Date): Orcamento {
		return this.transicionar("estornar", agora, { estornadoEm: agora.toISOString(), proximaTentativaEstornoEm: null });
	}

	registrarFalhaEstorno(erro: string, proximaTentativaEm: Date, agora: Date): Orcamento {
		return this.transicionar("registrar_falha_estorno", agora, {
			tentativasEstorno: this.dados.tentativasEstorno + 1,
			proximaTentativaEstornoEm: proximaTentativaEm.toISOString(),
			ultimoErroEstorno: erro,
		});
	}

	private transicionar(transicao: TransicaoOrcamento, agora: Date, alteracoes: Partial<DadosOrcamento>): Orcamento {
		if (!podeTransicionar(this.dados.status, transicao)) throw new TransicaoInvalidaError(this.dados.status, transicao);
		return new Orcamento({
			...this.dados,
			...alteracoes,
			status: proximoStatus(transicao),
			versao: this.dados.versao + 1,
			atualizadoEm: agora.toISOString(),
		});
	}
}
