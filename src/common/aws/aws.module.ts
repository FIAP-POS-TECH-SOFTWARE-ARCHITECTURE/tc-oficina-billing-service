import { Global, Module } from "@nestjs/common";
import { CLIENTE_DYNAMODB, CLIENTE_SNS, CLIENTE_SQS, provedoresClientesAws } from "./clientes-aws";

@Global()
@Module({ providers: provedoresClientesAws, exports: [CLIENTE_DYNAMODB, CLIENTE_SQS, CLIENTE_SNS] })
export class AwsModule {}
