import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class RejeitarOrcamentoDto {
	@ApiPropertyOptional({ example: "Valor acima do esperado", maxLength: 2000 })
	@IsOptional()
	@IsString()
	@MaxLength(2000)
	motivo?: string;
}
