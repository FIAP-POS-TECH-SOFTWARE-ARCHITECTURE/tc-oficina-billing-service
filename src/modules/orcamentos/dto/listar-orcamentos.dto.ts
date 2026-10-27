import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { StatusOrcamento } from "../domain/status-orcamento";

export class ListarOrcamentosDto {
	@ApiPropertyOptional({ enum: StatusOrcamento })
	@IsOptional()
	@IsEnum(StatusOrcamento)
	status?: StatusOrcamento;
}
