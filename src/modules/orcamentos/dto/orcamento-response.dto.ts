import { ApiProperty } from "@nestjs/swagger";
import type { Orcamento, TipoItemOrcamento } from "../domain/orcamento.entity";
import { StatusOrcamento } from "../domain/status-orcamento";

export class ItemOrcamentoResponseDto {
	@ApiProperty({ enum: ["SERVICO", "INSUMO"] })
	tipo!: TipoItemOrcamento;

	@ApiProperty({ example: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e" })
	referenciaId!: string;

	@ApiProperty({ example: "Troca de oleo" })
	descricao!: string;

	@ApiProperty({ example: 1 })
	quantidade!: number;

	@ApiProperty({ example: 12000, description: "Preço unitário em centavos" })
	precoUnitarioCentavos!: number;
}

export class OrcamentoResponseDto {
	@ApiProperty({ example: "5d6e7f80-9a0b-4c1d-8e2f-3a4b5c6d7e8f" })
	id!: string;

	@ApiProperty({ example: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" })
	osId!: string;

	@ApiProperty({ example: "OS-2026-000123" })
	numeroOs!: string;

	@ApiProperty({ enum: StatusOrcamento })
	status!: StatusOrcamento;

	@ApiProperty({ type: [ItemOrcamentoResponseDto] })
	itens!: ItemOrcamentoResponseDto[];

	@ApiProperty({ example: 30000, description: "Total em centavos" })
	valorTotalCentavos!: number;

	@ApiProperty({ example: "2026-10-23T13:05:00.000Z" })
	prazoAprovacaoEm!: string;

	@ApiProperty({ type: String, nullable: true, description: "Presente só enquanto o orçamento está APROVADO" })
	linkPagamento!: string | null;

	@ApiProperty({ type: String, nullable: true })
	prazoPagamentoEm!: string | null;

	@ApiProperty({ type: String, nullable: true })
	pagamentoId!: string | null;

	@ApiProperty({ example: "2026-10-20T13:05:01.000Z" })
	criadoEm!: string;

	@ApiProperty({ example: "2026-10-20T13:05:01.000Z" })
	atualizadoEm!: string;
}

export function paraOrcamentoResponse(orcamento: Orcamento): OrcamentoResponseDto {
	const d = orcamento.paraDados();
	return {
		id: d.id,
		osId: d.osId,
		numeroOs: d.numeroOs,
		status: d.status,
		itens: d.itens,
		valorTotalCentavos: d.valorTotalCentavos,
		prazoAprovacaoEm: d.prazoAprovacaoEm,
		linkPagamento: d.status === StatusOrcamento.APROVADO ? d.linkPagamento : null,
		prazoPagamentoEm: d.prazoPagamentoEm,
		pagamentoId: d.pagamentoId,
		criadoEm: d.criadoEm,
		atualizadoEm: d.atualizadoEm,
	};
}
