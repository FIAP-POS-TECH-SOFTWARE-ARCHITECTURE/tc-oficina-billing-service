import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE_SCHEMAS = "https://oficina.local/contratos/schemas";

export interface ResultadoValidacao {
	valido: boolean;
	erros: string[];
}

/** Valida mensagens recebidas com os mesmos JSON Schemas de `contratos/` usados nos testes de contrato. */
export class ValidadorContratos {
	private readonly ajv: Ajv2020;

	constructor(raiz = join(process.cwd(), "contratos")) {
		this.ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
		addFormats(this.ajv);
		const ler = (...caminho: string[]) => JSON.parse(readFileSync(join(raiz, ...caminho), "utf8")) as object;
		this.ajv.addSchema(ler("schemas", "envelope.schema.json"));
		for (const arquivo of readdirSync(join(raiz, "schemas", "payloads"))) this.ajv.addSchema(ler("schemas", "payloads", arquivo));
	}

	validar(mensagem: unknown): ResultadoValidacao {
		const envelope = this.ajv.getSchema(`${BASE_SCHEMAS}/envelope.schema.json`) as ValidateFunction;
		if (!envelope(mensagem)) return { valido: false, erros: this.formatar(envelope) };

		const { tipo, payload } = mensagem as { tipo: string; payload: unknown };
		const schemaPayload = this.ajv.getSchema(`${BASE_SCHEMAS}/payloads/${tipo}.schema.json`);
		if (!schemaPayload) return { valido: false, erros: [`tipo desconhecido: ${tipo}`] };
		if (!schemaPayload(payload)) return { valido: false, erros: this.formatar(schemaPayload) };

		return { valido: true, erros: [] };
	}

	private formatar(validacao: ValidateFunction): string[] {
		return (validacao.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""} ${JSON.stringify(e.params)}`.trim());
	}
}
