import { ApiProperty } from "@nestjs/swagger";

export class AprovacaoResponseDto {
	@ApiProperty({ example: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123" })
	linkPagamento!: string;

	@ApiProperty({ example: "2026-10-22T14:00:00.000Z" })
	prazoPagamentoEm!: string;
}
