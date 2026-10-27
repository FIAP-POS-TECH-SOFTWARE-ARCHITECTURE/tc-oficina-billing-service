import type { ClienteOrcamento, ItemOrcamento, VeiculoOrcamento } from "../domain/orcamento.entity";

export interface GerarOrcamentoPayload {
	cliente: ClienteOrcamento;
	veiculo: VeiculoOrcamento;
	itens: ItemOrcamento[];
	valorTotalCentavos: number;
	prazoAprovacaoEm: string;
	prazoPagamentoMinutos: number;
}

export interface PayloadComMotivo {
	motivo: string;
}
