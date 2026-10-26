import { Module } from "@nestjs/common";
import { ConsumidorSqs } from "./consumidor-sqs";
import { PUBLICADOR_MENSAGENS } from "./publicador-mensagens.port";
import { SnsSqsPublicador } from "./sns-sqs-publicador";
import { ValidadorContratos } from "./validador-contratos";

@Module({
	providers: [
		{ provide: ValidadorContratos, useFactory: () => new ValidadorContratos() },
		{ provide: PUBLICADOR_MENSAGENS, useClass: SnsSqsPublicador },
		ConsumidorSqs,
	],
	exports: [PUBLICADOR_MENSAGENS, ConsumidorSqs, ValidadorContratos],
})
export class MensageriaModule {}
