import { randomUUID } from "node:crypto";

export type OrigemMensagem = "os" | "billing" | "execution";

export interface EnvelopeMensagem<T = Record<string, unknown>> {
	messageId: string;
	tipo: string;
	versao: 1;
	ocorridoEm: string;
	origem: OrigemMensagem;
	fluxoId: string;
	osId: string;
	numeroOs: string;
	correlationId: string;
	payload: T;
}

export interface DadosNovoEnvelope<T> {
	tipo: string;
	origem: OrigemMensagem;
	fluxoId: string;
	osId: string;
	numeroOs: string;
	correlationId: string;
	payload: T;
	messageId?: string;
	ocorridoEm?: Date;
}

export function criarEnvelope<T>(dados: DadosNovoEnvelope<T>): EnvelopeMensagem<T> {
	return {
		messageId: dados.messageId ?? randomUUID(),
		tipo: dados.tipo,
		versao: 1,
		ocorridoEm: (dados.ocorridoEm ?? new Date()).toISOString(),
		origem: dados.origem,
		fluxoId: dados.fluxoId,
		osId: dados.osId,
		numeroOs: dados.numeroOs,
		correlationId: dados.correlationId,
		payload: dados.payload,
	};
}
