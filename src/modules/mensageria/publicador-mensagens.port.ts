import type { EnvelopeMensagem } from "./envelope";
import type { CabecalhosTrace } from "./trace";

export const PUBLICADOR_MENSAGENS = Symbol("PUBLICADOR_MENSAGENS");

export interface PublicadorMensagensPort {
	enviarComando(fila: string, envelope: EnvelopeMensagem<unknown>, trace?: CabecalhosTrace): Promise<void>;
	publicarEvento(envelope: EnvelopeMensagem<unknown>, trace?: CabecalhosTrace): Promise<void>;
}
