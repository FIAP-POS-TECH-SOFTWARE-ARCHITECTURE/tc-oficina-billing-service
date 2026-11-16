import { Order } from "mercadopago";
import { criarClientesMercadoPago } from "./clientes-mercado-pago";

describe("criarClientesMercadoPago", () => {
	it("cria o cliente de orders do SDK", () => {
		expect(criarClientesMercadoPago("TEST-x").orders).toBeInstanceOf(Order);
	});
});
