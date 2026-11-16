import { montarAtributos } from "./atributos-mensagem";
import { criarEnvelope } from "./envelope";

describe("montarAtributos", () => {
	const envelope = () =>
		criarEnvelope({
			tipo: "OrcamentoGerado",
			origem: "billing",
			fluxoId: "f",
			osId: "o",
			numeroOs: "OS-1",
			correlationId: "c",
			payload: {},
		});

	it("inclui cabeçalhos de trace presentes", () => {
		expect(montarAtributos(envelope(), { traceparent: "00-a-b-01", newrelic: "x" })).toEqual({
			tipo: { DataType: "String", StringValue: "OrcamentoGerado" },
			origem: { DataType: "String", StringValue: "billing" },
			traceparent: { DataType: "String", StringValue: "00-a-b-01" },
			newrelic: { DataType: "String", StringValue: "x" },
		});
	});

	it("sem trace mantém só tipo e origem", () => {
		expect(Object.keys(montarAtributos(envelope()))).toEqual(["tipo", "origem"]);
	});
});
