// Ferramenta manual para as credenciais de teste do Mercado Pago (API de Orders). Uso:
//   MERCADO_PAGO_ACCESS_TOKEN=... npx ts-node scripts/mercado-pago-sandbox.ts <criar|consultar|buscar|estornar> [argumento] [minutos]
import { MercadoPagoConfig, Order } from "mercadopago";
import { randomUUID } from "node:crypto";

const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!token) throw new Error("Defina MERCADO_PAGO_ACCESS_TOKEN com o access token de teste da aplicação");
const orders = new Order(new MercadoPagoConfig({ accessToken: token, options: { timeout: 10_000 } }));
const [comando, argumento, extra] = process.argv.slice(2);
const DIA_MS = 24 * 60 * 60_000;

const resumo = (o: Awaited<ReturnType<Order["get"]>>) => ({
	id: o.id,
	status: o.status,
	status_detail: o.status_detail,
	external_reference: o.external_reference,
	total_amount: o.total_amount,
	total_paid_amount: o.total_paid_amount,
	expiration_time: o.expiration_time,
	last_updated_date: o.last_updated_date,
	checkout_url: o.checkout_url,
	pagamentos: o.transactions?.payments?.map((p) => ({
		id: p.id,
		status: p.status,
		status_detail: p.status_detail,
		paid_amount: p.paid_amount,
		refunded_amount: p.refunded_amount,
	})),
	reembolsos: o.transactions?.refunds?.map((r) => ({ id: r.id, status: r.status, amount: r.amount })),
});

async function main(): Promise<unknown> {
	switch (comando) {
		case "criar": {
			const referencia = argumento ?? randomUUID();
			const minutos = Number(extra ?? 30);
			const callback = process.env.MERCADO_PAGO_NOTIFICATION_URL || undefined;
			return resumo(
				await orders.create({
					body: {
						type: "online",
						processing_mode: "manual",
						capture_mode: "automatic",
						external_reference: referencia,
						total_amount: "99.99",
						expiration_time: `PT${minutos * 60}S`,
						items: [{ external_code: "teste", title: "Teste de integração da oficina", quantity: 3, unit_price: "33.33" }],
						config: {
							payment_method: { not_allowed_types: ["ticket", "atm"], max_installments: 1 },
							online: { retries: { allowed: true }, ...(callback ? { callback_url: callback } : {}) },
						},
					},
					requestOptions: { idempotencyKey: `order-${referencia}` },
				}),
			);
		}
		case "consultar":
			return resumo(await orders.get({ id: argumento }));
		case "buscar": {
			const agora = Date.now();
			const r = await orders.search({
				options: {
					begin_date: new Date(agora - 28 * DIA_MS).toISOString(),
					end_date: new Date(agora).toISOString(),
					external_reference: argumento,
				},
			});
			return {
				paging: r.paging,
				orders: r.data?.map((o) => ({
					id: o.id,
					status: o.status,
					status_detail: o.status_detail,
					total_paid_amount: o.total_paid_amount,
				})),
			};
		}
		case "estornar":
			return resumo(await orders.refund({ id: argumento, requestOptions: { idempotencyKey: `sandbox-estorno-${argumento}` } }));
		default:
			throw new Error(
				"comando: criar [externalReference] [minutos] | consultar <orderId> | buscar <externalReference> | estornar <orderId>",
			);
	}
}

main()
	.then((r) => console.log(JSON.stringify(r, null, 2)))
	.catch((erro: { status?: number; message?: string; cause?: unknown }) => {
		console.error(JSON.stringify({ status: erro.status, message: erro.message, cause: erro.cause }, null, 2));
		process.exit(1);
	});
