export const GATEWAY_PAGAMENTO = Symbol("GATEWAY_PAGAMENTO");

export const STATUS_PAGAMENTO_APROVADO = "approved";
export const STATUS_PAGAMENTO_ESTORNADO = "refunded";

export interface ItemCobranca {
	referenciaId: string;
	descricao: string;
	quantidade: number;
	precoUnitarioCentavos: number;
}

export interface DadosCobranca {
	orcamentoId: string;
	numeroOs: string;
	itens: ItemCobranca[];
	valorTotalCentavos: number;
	expiraEm: Date;
}

export interface CobrancaCriada {
	preferenciaId: string;
	linkPagamento: string;
}

export interface PagamentoExterno {
	pagamentoId: string;
	status: string;
	orcamentoId: string | null;
	valorCentavos: number;
	pagoEm: string | null;
	bruto: Record<string, unknown>;
}

export interface EstornoRealizado {
	estornoId: string;
	valorCentavos: number;
}

export class ErroGatewayPagamento extends Error {
	constructor(
		message: string,
		readonly temporario: boolean,
		readonly statusHttp?: number,
	) {
		super(message);
		this.name = "ErroGatewayPagamento";
	}
}

export interface GatewayPagamentoPort {
	criarCobranca(dados: DadosCobranca): Promise<CobrancaCriada>;
	/** `null` quando o pagamento não existe no provedor. */
	consultarPagamento(pagamentoId: string): Promise<PagamentoExterno | null>;
	buscarPagamentosPorOrcamento(orcamentoId: string): Promise<PagamentoExterno[]>;
	estornar(pagamentoId: string, chaveIdempotencia: string): Promise<EstornoRealizado>;
}
