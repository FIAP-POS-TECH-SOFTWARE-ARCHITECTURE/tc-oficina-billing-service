import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Provider } from "@nestjs/common";

export const CLIENTE_DYNAMODB = Symbol("CLIENTE_DYNAMODB");
export const CLIENTE_SQS = Symbol("CLIENTE_SQS");
export const CLIENTE_SNS = Symbol("CLIENTE_SNS");

// AWS_ENDPOINT_URL (MiniStack) é lido nativamente pelo SDK v3; em homolog/prod não é definido.
const regiao = () => process.env.AWS_REGION ?? "us-east-1";

export const criarClienteDynamoDb = (): DynamoDBDocumentClient =>
	DynamoDBDocumentClient.from(new DynamoDBClient({ region: regiao() }), {
		marshallOptions: { removeUndefinedValues: true },
	});
export const criarClienteSqs = (): SQSClient => new SQSClient({ region: regiao() });
export const criarClienteSns = (): SNSClient => new SNSClient({ region: regiao() });

export const provedoresClientesAws: Provider[] = [
	{ provide: CLIENTE_DYNAMODB, useFactory: criarClienteDynamoDb },
	{ provide: CLIENTE_SQS, useFactory: criarClienteSqs },
	{ provide: CLIENTE_SNS, useFactory: criarClienteSns },
];
