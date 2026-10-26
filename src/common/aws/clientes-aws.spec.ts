import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { criarClienteDynamoDb, criarClienteSns, criarClienteSqs, provedoresClientesAws } from "./clientes-aws";

describe("clientes AWS", () => {
	it("cria clientes na região configurada", async () => {
		process.env.AWS_REGION = "us-east-1";
		expect(criarClienteDynamoDb()).toBeInstanceOf(DynamoDBDocumentClient);
		expect(criarClienteSqs()).toBeInstanceOf(SQSClient);
		expect(await criarClienteSns().config.region()).toBe("us-east-1");
	});

	it("expõe um provider por cliente", () => {
		expect(provedoresClientesAws).toHaveLength(3);
	});
});
