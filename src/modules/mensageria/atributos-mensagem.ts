import type { EnvelopeMensagem } from "./envelope";

export type AtributosMensagem = Record<string, { DataType: "String"; StringValue: string }>;

/** MessageAttributes de SQS SendMessage e SNS Publish. Ponto de injeção do trace distribuído (traceparent/newrelic). */
export function montarAtributos(envelope: EnvelopeMensagem<unknown>): AtributosMensagem {
	return {
		tipo: { DataType: "String", StringValue: envelope.tipo },
		origem: { DataType: "String", StringValue: envelope.origem },
	};
}
