import { STATUS_PAGAMENTO_APROVADO, STATUS_PAGAMENTO_ESTORNADO } from "../../../application/ports/gateway-pagamento.port";

export function centavosParaDecimal(centavos: number): string {
	if (!Number.isSafeInteger(centavos) || centavos < 0) throw new RangeError(`Valor em centavos inválido: ${centavos}`);
	return `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** A API de Orders devolve valores como string decimal ("33.33", "300"); a conversão é exata, sem float. */
export function decimalParaCentavos(valor: string | undefined): number {
	if (valor === undefined || valor === "") return 0;
	const partes = /^(\d+)(?:\.(\d{1,2}))?$/.exec(valor.trim());
	if (!partes) throw new RangeError(`Valor decimal inválido: ${valor}`);
	return Number(partes[1]) * 100 + Number((partes[2] ?? "").padEnd(2, "0"));
}

/** `expiration_time` é duração a partir da criação; arredonda para baixo para a order nunca passar do prazo. */
export function duracaoAte(expiraEm: Date, agora: Date): string {
	const segundos = Math.floor((expiraEm.getTime() - agora.getTime()) / 1000);
	if (segundos <= 0) throw new RangeError(`Prazo de pagamento já vencido: ${expiraEm.toISOString()}`);
	return `PT${segundos}S`;
}

export function statusDaOrder(status?: string, detalhe?: string): string {
	if (status === "processed" && detalhe === "accredited") return STATUS_PAGAMENTO_APROVADO;
	if (status === "refunded") return STATUS_PAGAMENTO_ESTORNADO;
	if (!status) return "desconhecido";
	return detalhe ? `${status}/${detalhe}` : status;
}
