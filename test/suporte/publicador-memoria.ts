import type { EnvelopeMensagem } from "../../src/modules/mensageria/envelope";
import type { PublicadorMensagensPort } from "../../src/modules/mensageria/publicador-mensagens.port";

export class PublicadorMemoria implements PublicadorMensagensPort {
	readonly eventos: EnvelopeMensagem<any>[] = [];
	readonly comandos: { fila: string; envelope: EnvelopeMensagem<unknown> }[] = [];
	falhar = false;

	async enviarComando(fila: string, envelope: EnvelopeMensagem<unknown>): Promise<void> {
		this.comandos.push({ fila, envelope });
	}

	async publicarEvento(envelope: EnvelopeMensagem<unknown>): Promise<void> {
		if (this.falhar) throw new Error("SNS indisponível (simulado)");
		this.eventos.push(envelope);
	}

	doTipo(tipo: string): EnvelopeMensagem<any>[] {
		return this.eventos.filter((e) => e.tipo === tipo);
	}
}
