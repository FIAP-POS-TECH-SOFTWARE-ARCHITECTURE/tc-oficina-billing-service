import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ApiEnvelopedResponse } from "../../../common/decorators/api-enveloped-response.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { Role } from "../../../common/enums/role.enum";
import { ConsultarOrcamentoUseCase } from "../application/use-cases/consultar-orcamento.use-case";
import { ListarOrcamentosUseCase } from "../application/use-cases/listar-orcamentos.use-case";
import { ListarOrcamentosDto } from "../dto/listar-orcamentos.dto";
import { OrcamentoResponseDto } from "../dto/orcamento-response.dto";

@ApiTags("Orçamentos (oficina)")
@ApiBearerAuth()
@Roles(Role.ATENDENTE, Role.ADMINISTRADOR)
@Controller("billing/orcamentos")
export class OrcamentosController {
	constructor(
		private readonly listarUc: ListarOrcamentosUseCase,
		private readonly consultarUc: ConsultarOrcamentoUseCase,
	) {}

	@Get()
	@ApiOperation({ summary: "Listar orçamentos (opcionalmente por status), mais recentes primeiro" })
	@ApiEnvelopedResponse(OrcamentoResponseDto, { isArray: true })
	listar(@Query() query: ListarOrcamentosDto) {
		return this.listarUc.execute(query.status);
	}

	@Get(":numeroOs")
	@ApiOperation({ summary: "Consultar o orçamento de uma OS" })
	@ApiEnvelopedResponse(OrcamentoResponseDto)
	consultar(@Param("numeroOs") numeroOs: string) {
		return this.consultarUc.execute(numeroOs);
	}
}
