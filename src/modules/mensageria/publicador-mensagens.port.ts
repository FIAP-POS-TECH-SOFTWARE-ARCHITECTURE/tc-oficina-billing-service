import type { EnvelopeMensagem } from "./envelope";

export const PUBLICADOR_MENSAGENS = Symbol("PUBLICADOR_MENSAGENS");

export interface PublicadorMensagensPort {
	enviarComando(fila: string, envelope: EnvelopeMensagem<unknown>): Promise<void>;
	publicarEvento(envelope: EnvelopeMensagem<unknown>): Promise<void>;
}
