import { WebhookSignatureValidator } from "mercadopago";
import { createHmac } from "node:crypto";
import { gerarAssinaturaMercadoPago, montarManifesto, validarAssinaturaMercadoPago } from "./assinatura-mercado-pago";

const agora = new Date("2026-10-20T13:00:00.000Z");
const ts = String(agora.getTime());
const segredo = "segredo";
const id = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";
const requestId = "mp-1";

const validar = (assinatura: string | undefined, sobrescrever: Partial<Parameters<typeof validarAssinaturaMercadoPago>[0]> = {}) =>
	validarAssinaturaMercadoPago({ assinatura, requestId, dataId: id, segredo, agora, ...sobrescrever });

const assinar = (sobrescrever: Partial<Parameters<typeof gerarAssinaturaMercadoPago>[0]> = {}) =>
	gerarAssinaturaMercadoPago({ dataId: id, requestId, segredo, ts, ...sobrescrever });

describe("assinatura das notificações do Mercado Pago", () => {
	it("aceita a assinatura gerada para a mesma notificação", () => {
		expect(validar(assinar())).toEqual({ valida: true });
	});

	it("monta o mesmo manifesto que o validador do SDK", () => {
		expect(() =>
			WebhookSignatureValidator.validate({ xSignature: assinar(), xRequestId: requestId, dataId: id.toLowerCase(), secret: segredo }),
		).not.toThrow();
	});

	it("usa o id em minúsculas no manifesto", () => {
		expect(validar(assinar({ dataId: id.toLowerCase() }))).toEqual({ valida: true });

		const v1Maiusculas = createHmac("sha256", segredo).update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
		expect(validar(`ts=${ts},v1=${v1Maiusculas}`)).toEqual({ valida: false, motivo: "ASSINATURA_DIVERGENTE" });
	});

	it("usa só o primeiro valor do x-request-id", () => {
		expect(validar(assinar(), { requestId: "mp-1, gw-2" })).toEqual({ valida: true });
	});

	describe("assinatura divergente", () => {
		it("v1 alterado", () => {
			const assinatura = assinar();
			const ultimo = assinatura.at(-1) === "0" ? "1" : "0";
			expect(validar(`${assinatura.slice(0, -1)}${ultimo}`)).toEqual({ valida: false, motivo: "ASSINATURA_DIVERGENTE" });
		});

		it("segredo diferente", () => {
			expect(validar(assinar({ segredo: "outro" }))).toEqual({ valida: false, motivo: "ASSINATURA_DIVERGENTE" });
		});

		it("v1 com tamanho diferente", () => {
			expect(validar(`ts=${ts},v1=abc123`)).toEqual({ valida: false, motivo: "ASSINATURA_DIVERGENTE" });
		});
	});

	describe("tolerância do ts", () => {
		it("ts em milissegundos de 2 h atrás → fora da tolerância", () => {
			const antigo = String(agora.getTime() - 2 * 60 * 60_000);
			expect(validar(assinar({ ts: antigo }))).toEqual({ valida: false, motivo: "FORA_DA_TOLERANCIA" });
		});

		it("ts em segundos atual → válida", () => {
			expect(validar(assinar({ ts: String(Math.floor(agora.getTime() / 1000)) }))).toEqual({ valida: true });
		});
	});

	describe("entrada inválida", () => {
		it("sem header → SEM_ASSINATURA", () => {
			expect(validar(undefined)).toEqual({ valida: false, motivo: "SEM_ASSINATURA" });
		});

		it("segredo vazio → SEM_SEGREDO", () => {
			expect(validar(assinar(), { segredo: "" })).toEqual({ valida: false, motivo: "SEM_SEGREDO" });
		});

		it.each(["ts=abc,v1=zz", "v1=aa", "lixo"])("%p → FORMATO_INVALIDO", (assinatura) => {
			expect(validar(assinatura)).toEqual({ valida: false, motivo: "FORMATO_INVALIDO" });
		});
	});

	describe("montarManifesto", () => {
		it("só com ts", () => {
			expect(montarManifesto(undefined, undefined, "1")).toBe("ts:1;");
		});

		it("com id e request-id", () => {
			expect(montarManifesto("ORD01AB", "r", "1")).toBe("id:ord01ab;request-id:r;ts:1;");
		});
	});
});
