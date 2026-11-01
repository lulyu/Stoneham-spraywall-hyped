output "api_url" {
  description = "Base URL for the HTTP API."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "dynamodb_table_name" {
  description = "DynamoDB table backing the application."
  value       = aws_dynamodb_table.app.name
}

output "lambda_function_name" {
  description = "Backend Lambda function name."
  value       = aws_lambda_function.api.function_name
}
