import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ValidadorContratos } from "./validador-contratos";

const exemplo = (arquivo: string) =>
	JSON.parse(readFileSync(join(process.cwd(), "contratos", "exemplos", arquivo), "utf8")) as Record<string, unknown>;

describe("ValidadorContratos", () => {
	const validador = new ValidadorContratos();

	it("aceita exemplo válido do contrato", () => {
		expect(validador.validar(exemplo("GerarOrcamento.json"))).toEqual({ valido: true, erros: [] });
	});

	it("rejeita envelope com campo extra", () => {
		const r = validador.validar({ ...exemplo("GerarOrcamento.json"), prioridade: 1 });
		expect(r.valido).toBe(false);
		expect(r.erros.join(" ")).toContain("additional");
	});

	it("rejeita payload fora do schema do tipo", () => {
		const r = validador.validar({ ...exemplo("CancelarOrcamento.json"), payload: {} });
		expect(r.valido).toBe(false);
		expect(r.erros.join(" ")).toContain("motivo");
	});

	it("rejeita tipo sem schema", () => {
		expect(validador.validar({ ...exemplo("CancelarOrcamento.json"), tipo: "TipoInventado" })).toEqual({
			valido: false,
			erros: ["tipo desconhecido: TipoInventado"],
		});
	});
});
