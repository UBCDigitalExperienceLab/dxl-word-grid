data "aws_caller_identity" "current" {}

# ── DynamoDB: single table for rooms, players, and connections ──────

resource "aws_dynamodb_table" "rooms" {
  name         = "${var.name_prefix}-rooms"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  # Abandoned rooms/connections self-expire (store.js sets expiresAt).
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ── IAM role for the WebSocket Lambda ───────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.name_prefix}-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda" {
  name = "${var.name_prefix}-lambda"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.rooms.arn,
          "${aws_dynamodb_table.rooms.arn}/index/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "execute-api:ManageConnections"
        ]
        Resource = "*"
      }
    ]
  })
}

# ── Lambda (placeholder code; real bundle deployed via pnpm deploy:lambdas) ──

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"
  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' });"
    filename = "index.js"
  }
}

resource "aws_lambda_function" "ws" {
  function_name    = "${var.name_prefix}-ws"
  role             = aws_iam_role.lambda.arn
  depends_on       = [aws_iam_role_policy.lambda]
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 512
  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.rooms.name
      PUBLIC_URL = var.public_url
    }
  }
  # The deploy script replaces the code + refreshes env; ignore drift on those.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_cloudwatch_log_group" "ws" {
  name              = "/aws/lambda/${aws_lambda_function.ws.function_name}"
  retention_in_days = 14
}

# ── API Gateway WebSocket ───────────────────────────────────────────

resource "aws_apigatewayv2_api" "ws" {
  name                       = "${var.name_prefix}-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "ws" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.ws.invoke_arn
}

resource "aws_apigatewayv2_route" "ws_connect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.ws.id}"
}

resource "aws_apigatewayv2_route" "ws_disconnect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws.id}"
}

resource "aws_apigatewayv2_route" "ws_default" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ws.id}"
}

resource "aws_apigatewayv2_stage" "ws" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = "dev"
  auto_deploy = true
}

resource "aws_lambda_permission" "ws" {
  statement_id  = "AllowWs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

# ── Outputs ─────────────────────────────────────────────────────────

output "ws_api_url" {
  description = "Base WebSocket endpoint. Append the stage, e.g. wss://<id>.execute-api.<region>.amazonaws.com/dev"
  value       = aws_apigatewayv2_api.ws.api_endpoint
}

output "ws_stage_url" {
  description = "Full wss:// URL to put in VITE_WS_URL."
  value       = "${aws_apigatewayv2_api.ws.api_endpoint}/${aws_apigatewayv2_stage.ws.name}"
}

output "table_name" {
  value = aws_dynamodb_table.rooms.name
}

output "lambda_name" {
  value = aws_lambda_function.ws.function_name
}
