import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCIA_ASSINATURA_SEGUNDOS = 3600;

export type MotivoAssinaturaInvalida =
	"SEM_SEGREDO" | "SEM_ASSINATURA" | "FORMATO_INVALIDO" | "ASSINATURA_DIVERGENTE" | "FORA_DA_TOLERANCIA";
export type ResultadoAssinatura = { valida: true } | { valida: false; motivo: MotivoAssinaturaInvalida };

export interface ParametrosAssinatura {
	assinatura?: string;
	requestId?: string;
	dataId?: string;
	segredo: string;
	agora: Date;
	toleranciaSegundos?: number;
}

const invalida = (motivo: MotivoAssinaturaInvalida): ResultadoAssinatura => ({ valida: false, motivo });

// Defesa extra: se algum proxy anexar outro id ("<mp>,<gateway>"), vale o do Mercado Pago.
const primeiroValor = (header?: string) => header?.split(",")[0]?.trim() || undefined;

export function montarManifesto(dataId: string | undefined, requestId: string | undefined, ts: string): string {
	const partes: string[] = [];
	if (dataId) partes.push(`id:${dataId.toLowerCase()}`);
	if (requestId) partes.push(`request-id:${requestId}`);
	partes.push(`ts:${ts}`);
	return `${partes.join(";")};`;
}

const hmac = (segredo: string, manifesto: string) => createHmac("sha256", segredo).update(manifesto).digest("hex");

export function gerarAssinaturaMercadoPago(p: { dataId?: string; requestId?: string; segredo: string; ts: string }): string {
	return `ts=${p.ts},v1=${hmac(p.segredo, montarManifesto(p.dataId, primeiroValor(p.requestId), p.ts))}`;
}

export function validarAssinaturaMercadoPago(p: ParametrosAssinatura): ResultadoAssinatura {
	if (!p.segredo) return invalida("SEM_SEGREDO");
	if (!p.assinatura) return invalida("SEM_ASSINATURA");

	const partes = new Map(
		p.assinatura.split(",").map((parte) => {
			const [chave, ...valor] = parte.split("=");
			return [chave.trim(), valor.join("=").trim()] as const;
		}),
	);
	const ts = partes.get("ts");
	const v1 = partes.get("v1");
	if (!ts || !v1 || !/^\d+$/.test(ts) || !/^[0-9a-f]+$/i.test(v1)) return invalida("FORMATO_INVALIDO");

	const esperado = Buffer.from(hmac(p.segredo, montarManifesto(p.dataId, primeiroValor(p.requestId), ts)));
	const recebido = Buffer.from(v1.toLowerCase());
	if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return invalida("ASSINATURA_DIVERGENTE");

	// A doc mostra ts em milissegundos; aceita também segundos (10 dígitos).
	const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
	const tolerancia = (p.toleranciaSegundos ?? TOLERANCIA_ASSINATURA_SEGUNDOS) * 1000;
	if (Math.abs(p.agora.getTime() - tsMs) > tolerancia) return invalida("FORA_DA_TOLERANCIA");

	return { valida: true };
}
