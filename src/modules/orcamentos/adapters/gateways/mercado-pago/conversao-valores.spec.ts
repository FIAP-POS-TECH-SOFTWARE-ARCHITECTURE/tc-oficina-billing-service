import { centavosParaDecimal, decimalParaCentavos, duracaoAte, statusDaOrder } from "./conversao-valores";

describe("conversão de valores do Mercado Pago", () => {
	it.each([
		[0, "0.00"],
		[1, "0.01"],
		[1999, "19.99"],
		[3333, "33.33"],
		[12345, "123.45"],
		[30000, "300.00"],
	])("centavosParaDecimal(%p) → %p", (centavos, esperado) => {
		expect(centavosParaDecimal(centavos)).toBe(esperado);
	});

	it.each([1.5, -1])("centavosParaDecimal(%p) → RangeError", (centavos) => {
		expect(() => centavosParaDecimal(centavos)).toThrow(RangeError);
	});

	it.each([
		["0.29", 29],
		["19.99", 1999],
		["99.99", 9999],
		["0.3", 30],
		["300", 30000],
		["4500", 450000],
		[undefined, 0],
	])("decimalParaCentavos(%p) → %p", (valor, esperado) => {
		expect(decimalParaCentavos(valor)).toBe(esperado);
	});

	it.each(["abc", "1.999", "-1"])("decimalParaCentavos(%p) → RangeError", (valor) => {
		expect(() => decimalParaCentavos(valor)).toThrow(RangeError);
	});

	describe("duracaoAte", () => {
		const agora = new Date("2026-10-20T13:00:00.000Z");

		it("converte o prazo em segundos", () => {
			expect(duracaoAte(new Date(agora.getTime() + 30 * 60_000), agora)).toBe("PT1800S");
		});

		it("arredonda para baixo", () => {
			expect(duracaoAte(new Date(agora.getTime() + 1500), agora)).toBe("PT1S");
		});

		it.each([0, -60_000])("prazo vencido (%p ms) → RangeError", (deslocamento) => {
			expect(() => duracaoAte(new Date(agora.getTime() + deslocamento), agora)).toThrow(RangeError);
		});
	});

	it.each([
		["processed", "accredited", "approved"],
		["processed", "partially_refunded", "processed/partially_refunded"],
		["refunded", "refunded", "refunded"],
		["created", "created", "created/created"],
		["canceled", "canceled", "canceled/canceled"],
		[undefined, undefined, "desconhecido"],
	])("statusDaOrder(%p, %p) → %p", (status, detalhe, esperado) => {
		expect(statusDaOrder(status, detalhe)).toBe(esperado);
	});
});
