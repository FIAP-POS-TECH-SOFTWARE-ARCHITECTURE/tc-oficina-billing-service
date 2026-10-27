import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
	const db = { send: jest.fn() };
	const controller = new HealthController(db as never);

	beforeEach(() => {
		jest.clearAllMocks();
		process.env.DYNAMODB_TABLE = "oficina-billing-teste";
	});

	it("liveness responde ok sem tocar no banco", () => {
		expect(controller.live()).toEqual({ status: "ok" });
		expect(db.send).not.toHaveBeenCalled();
	});

	it("readiness consulta a tabela", async () => {
		db.send.mockResolvedValue({});
		await expect(controller.ready()).resolves.toEqual({ status: "ok", dynamodb: "up" });
		expect(db.send.mock.calls[0][0].input).toEqual({ TableName: "oficina-billing-teste", Key: { pk: "HEALTH", sk: "HEALTH" } });
	});

	it("readiness devolve 503 quando o DynamoDB falha", async () => {
		db.send.mockRejectedValue(new Error("sem credencial"));
		await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
	});
});
