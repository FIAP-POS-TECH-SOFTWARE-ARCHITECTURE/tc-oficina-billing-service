import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { ClienteAuth } from "../../../common/decorators/cliente-auth.decorator";
import { type AuthenticatedCliente, CurrentCliente } from "../../../common/decorators/current-cliente.decorator";
import { correlationIdDaRequisicao } from "../../../common/utils/correlation-id.util";
import { AprovarOrcamentoUseCase } from "../application/use-cases/aprovar-orcamento.use-case";
import { ConsultarOrcamentoClienteUseCase } from "../application/use-cases/consultar-orcamento-cliente.use-case";
import { RejeitarOrcamentoUseCase } from "../application/use-cases/rejeitar-orcamento.use-case";
import { AprovacaoResponseDto } from "../dto/aprovacao-response.dto";
import { OrcamentoResponseDto } from "../dto/orcamento-response.dto";
import { RejeitarOrcamentoDto } from "../dto/rejeitar-orcamento.dto";

@ApiTags("Orçamentos (cliente)")
@ApiBearerAuth()
@ClienteAuth()
@Controller("billing/cliente/orcamentos")
export class OrcamentosClienteController {
	constructor(
		private readonly consultarUc: ConsultarOrcamentoClienteUseCase,
		private readonly aprovarUc: AprovarOrcamentoUseCase,
		private readonly rejeitarUc: RejeitarOrcamentoUseCase,
	) {}

	@Get(":numeroOs")
	@ApiOperation({ summary: "Consultar o orçamento da própria OS (token de cliente via CPF)" })
	@ApiEnvelopedResponse(OrcamentoResponseDto)
	consultar(@Param("numeroOs") numeroOs: string, @CurrentCliente() cliente: AuthenticatedCliente) {
		return this.consultarUc.execute(numeroOs, cliente.id);
	}

	@Post(":numeroOs/aprovar")
	@HttpCode(200)
	@ApiOperation({ summary: "Aprovar o orçamento e receber o link de pagamento" })
	@ApiEnvelopedResponse(AprovacaoResponseDto)
	aprovar(@Param("numeroOs") numeroOs: string, @CurrentCliente() cliente: AuthenticatedCliente, @Req() req: Request) {
		return this.aprovarUc.execute(numeroOs, cliente.id, correlationIdDaRequisicao(req));
	}

	@Post(":numeroOs/rejeitar")
	@HttpCode(200)
	@ApiOperation({ summary: "Rejeitar o orçamento" })
	@ApiEnvelopedResponse(OrcamentoResponseDto)
	rejeitar(
		@Param("numeroOs") numeroOs: string,
		@Body() dto: RejeitarOrcamentoDto,
		@CurrentCliente() cliente: AuthenticatedCliente,
		@Req() req: Request,
	) {
		return this.rejeitarUc.execute(numeroOs, cliente.id, dto.motivo ?? null, correlationIdDaRequisicao(req));
	}
}
