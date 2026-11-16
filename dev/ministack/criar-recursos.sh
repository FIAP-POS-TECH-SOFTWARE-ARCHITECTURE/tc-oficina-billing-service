#!/bin/sh
set -eu
AWS="aws --endpoint-url ${AWS_ENDPOINT_URL}"
$AWS dynamodb describe-table --table-name oficina-billing-local >/dev/null 2>&1 || $AWS dynamodb create-table \
  --table-name oficina-billing-local --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S AttributeName=gsi1pk,AttributeType=S AttributeName=gsi1sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --global-secondary-indexes '[{"IndexName":"gsi1","KeySchema":[{"AttributeName":"gsi1pk","KeyType":"HASH"},{"AttributeName":"gsi1sk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' >/dev/null
TOPICO=$($AWS sns create-topic --name oficina-local-eventos --query TopicArn --output text)
DLQ=$($AWS sqs create-queue --queue-name oficina-local-billing-comandos-dlq --query QueueUrl --output text)
DLQ_ARN=$($AWS sqs get-queue-attributes --queue-url "$DLQ" --attribute-names QueueArn --query Attributes.QueueArn --output text)
printf '{"VisibilityTimeout":"60","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' "$DLQ_ARN" > /tmp/atributos.json
COMANDOS=$($AWS sqs create-queue --queue-name oficina-local-billing-comandos --attributes file:///tmp/atributos.json --query QueueUrl --output text)
ORQ=$($AWS sqs create-queue --queue-name oficina-local-os-orquestrador-eventos --query QueueUrl --output text)
ORQ_ARN=$($AWS sqs get-queue-attributes --queue-url "$ORQ" --attribute-names QueueArn --query Attributes.QueueArn --output text)
$AWS sns subscribe --topic-arn "$TOPICO" --protocol sqs --notification-endpoint "$ORQ_ARN" \
  --attributes '{"RawMessageDelivery":"true","FilterPolicyScope":"MessageAttributes","FilterPolicy":"{\"origem\":[\"billing\",\"execution\"]}"}' >/dev/null
echo "DYNAMODB_TABLE=oficina-billing-local"
echo "SNS_EVENTOS_ARN=$TOPICO"
echo "SQS_BILLING_COMANDOS_URL=$COMANDOS"
echo "fila observável dos eventos: $ORQ"
