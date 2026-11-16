import { MercadoPagoConfig, Order } from "mercadopago";

export interface ClientesMercadoPago {
	orders: Pick<Order, "create" | "get" | "search" | "refund">;
}

export function criarClientesMercadoPago(accessToken: string): ClientesMercadoPago {
	// Padrão do SDK é longo demais para a janela de 22 s do webhook e para a aprovação síncrona.
	const config = new MercadoPagoConfig({ accessToken, options: { timeout: 8_000, maxRetries: 2 } });
	return { orders: new Order(config) };
}
