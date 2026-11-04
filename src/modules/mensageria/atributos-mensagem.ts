import type { EnvelopeMensagem } from "./envelope";
import type { CabecalhosTrace } from "./trace";

export type AtributosMensagem = Record<string, { DataType: "String"; StringValue: string }>;

/** MessageAttributes de SQS SendMessage e SNS Publish. Ponto de injeção do trace distribuído (traceparent/newrelic). */
export function montarAtributos(envelope: EnvelopeMensagem<unknown>, trace: CabecalhosTrace = {}): AtributosMensagem {
	const atributos: AtributosMensagem = {
		tipo: { DataType: "String", StringValue: envelope.tipo },
		origem: { DataType: "String", StringValue: envelope.origem },
	};
	for (const [chave, valor] of Object.entries(trace)) if (valor) atributos[chave] = { DataType: "String", StringValue: valor };
	return atributos;
}
