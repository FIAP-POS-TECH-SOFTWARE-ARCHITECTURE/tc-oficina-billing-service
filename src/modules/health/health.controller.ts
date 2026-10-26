import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CLIENTE_DYNAMODB } from "../../common/aws/clientes-aws";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags("Health")
@Controller("health")
export class HealthController {
	constructor(@Inject(CLIENTE_DYNAMODB) private readonly db: DynamoDBDocumentClient) {}

	@Public()
	@Get()
	@ApiOperation({ summary: "Liveness probe" })
	live() {
		return { status: "ok" };
	}

	@Public()
	@Get("ready")
	@ApiOperation({ summary: "Readiness probe (verifica acesso à tabela DynamoDB)" })
	async ready() {
		try {
			await this.db.send(new GetCommand({ TableName: process.env.DYNAMODB_TABLE, Key: { pk: "HEALTH", sk: "HEALTH" } }));
			return { status: "ok", dynamodb: "up" };
		} catch {
			throw new ServiceUnavailableException({ status: "error", dynamodb: "down" });
		}
	}
}
