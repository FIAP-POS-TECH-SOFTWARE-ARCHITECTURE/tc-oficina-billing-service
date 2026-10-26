import { montarAtributos } from "./atributos-mensagem";
import { criarEnvelope } from "./envelope";

describe("criarEnvelope / montarAtributos", () => {
	const base = {
		tipo: "OrcamentoGerado",
		origem: "billing" as const,
		fluxoId: "3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8",
		osId: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
		numeroOs: "OS-2026-000123",
		correlationId: "req-1",
		payload: { orcamentoId: "5d6e7f80-9a0b-4c1d-8e2f-3a4b5c6d7e8f", valorTotalCentavos: 30000 },
	};

	it("gera messageId uuid, versao 1 e ocorridoEm ISO", () => {
		const envelope = criarEnvelope(base);
		expect(envelope.messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(envelope.versao).toBe(1);
		expect(new Date(envelope.ocorridoEm).toISOString()).toBe(envelope.ocorridoEm);
		expect(envelope).toMatchObject(base);
	});

	it("mantém messageId e data informados (reenvio preserva a chave de idempotência)", () => {
		const envelope = criarEnvelope({ ...base, messageId: "m-fixo", ocorridoEm: new Date("2026-10-20T13:05:00.000Z") });
		expect(envelope.messageId).toBe("m-fixo");
		expect(envelope.ocorridoEm).toBe("2026-10-20T13:05:00.000Z");
	});

	it("atributos tipo e origem como String (origem alimenta o FilterPolicy do SNS)", () => {
		expect(montarAtributos(criarEnvelope(base))).toEqual({
			tipo: { DataType: "String", StringValue: "OrcamentoGerado" },
			origem: { DataType: "String", StringValue: "billing" },
		});
	});
});
