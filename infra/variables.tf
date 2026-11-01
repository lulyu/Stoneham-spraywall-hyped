variable "project_name" {
  type        = string
  description = "Stable project prefix used in AWS resource names."
  default     = "stoneham-spraywall"
}

variable "aws_region" {
  type        = string
  description = "AWS region for the API, Lambda, and DynamoDB table."
  default     = "us-east-1"
}

variable "allowed_origins" {
  type        = list(string)
  description = "Origins allowed by API Gateway CORS. Dev may use [\"*\"]."
  default     = ["*"]
}

variable "lambda_memory_mb" {
  type        = number
  description = "Lambda memory allocation."
  default     = 256
}

variable "lambda_timeout_seconds" {
  type        = number
  description = "Lambda request timeout."
  default     = 10
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention."
  default     = 14
}

variable "enable_point_in_time_recovery" {
  type        = bool
  description = "Enable DynamoDB point-in-time recovery. Recommended for prod."
  default     = false
}
