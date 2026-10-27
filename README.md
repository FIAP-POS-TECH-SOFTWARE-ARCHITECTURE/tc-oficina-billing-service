# tc-oficina-billing-service

Microsserviço de orçamento e pagamento da oficina mecânica (Tech Challenge FIAP SOAT, Fase 4, grupo **Integradores**).
Gera o orçamento da OS a partir do comando `GerarOrcamento`, deixa o cliente aprovar ou rejeitar e cria a cobrança na aprovação.
Persiste em DynamoDB (tabela única), recebe comandos pela fila SQS `oficina-<env>-billing-comandos` e publica eventos no tópico SNS `oficina-<env>-eventos`.

## Executar localmente

Pré-requisitos: Docker e AWS CLI (só para enviar comandos de teste à fila).

```bash
cp .env.example .env   # preencher JWT_SECRET com o mesmo valor do os-service local
docker compose up -d --build
docker compose logs ministack-init   # nomes da tabela, do tópico e das filas criados no emulador
curl -s localhost:3001/health/ready  # {"status":200,"success":true,"data":{"status":"ok","dynamodb":"up"}}
```

Enviar um `GerarOrcamento` de exemplo e ler o evento que o orquestrador receberia:

```bash
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1
aws --endpoint-url http://localhost:4566 sqs send-message \
  --queue-url http://localhost:4566/000000000000/oficina-local-billing-comandos \
  --message-body file://contratos/exemplos/GerarOrcamento.json \
  --message-attributes '{"tipo":{"DataType":"String","StringValue":"GerarOrcamento"},"origem":{"DataType":"String","StringValue":"os"}}'
aws --endpoint-url http://localhost:4566 sqs receive-message \
  --queue-url http://localhost:4566/000000000000/oficina-local-os-orquestrador-eventos --message-attribute-names All
docker compose down
```

Sem Docker para o app (só o emulador): `npm run ministack:up`, criar os recursos com `dev/ministack/criar-recursos.sh` (com `AWS_ENDPOINT_URL=http://localhost:4566`) e `npm run start:dev`.

## Testes

```bash
npm test                  # unitários + BDD (jest-cucumber)
npm run test:cov          # com cobertura (mínimo de 80% em linhas, branches, funções e statements)
npm run test:integracao   # DynamoDB, SNS e SQS reais no MiniStack (Testcontainers; requer Docker)
```

## Documentação da API

Swagger em `/billing/docs` (JSON em `/billing/docs-json`). O prefixo `/billing` é o mesmo usado pelo API Gateway, que repassa `/billing/*` a este serviço sem reescrever o path.
