// Gera um curl de notificação assinada para testar o webhook sem esperar o Mercado Pago. Uso:
//   MERCADO_PAGO_WEBHOOK_SECRET=... npx ts-node scripts/assinar-notificacao-mercado-pago.ts <urlBase> <orderId>
import { randomUUID } from "node:crypto";
import { gerarAssinaturaMercadoPago } from "../src/modules/orcamentos/adapters/webhook/assinatura-mercado-pago";

const [urlBase, orderId] = process.argv.slice(2);
const segredo = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
if (!urlBase || !orderId || !segredo) throw new Error("uso: <urlBase> <orderId> com MERCADO_PAGO_WEBHOOK_SECRET definido");
const requestId = randomUUID();
// ts em milissegundos, como a doc da API de Orders mostra.
const assinatura = gerarAssinaturaMercadoPago({ dataId: orderId, requestId, segredo, ts: String(Date.now()) });
const corpo = JSON.stringify({ type: "order", action: "order.processed", data: { id: orderId } });
console.log(
	`curl -i -X POST '${urlBase}/billing/webhooks/mercado-pago?data.id=${orderId}&type=order' -H 'content-type: application/json' -H 'x-request-id: ${requestId}' -H 'x-signature: ${assinatura}' -d '${corpo}'`,
);
