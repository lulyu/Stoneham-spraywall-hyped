locals {
  environment = terraform.workspace
  name_prefix = "${var.project_name}-${local.environment}"
}

resource "terraform_data" "workspace_guard" {
  input = local.environment

  lifecycle {
    precondition {
      condition     = contains(["dev", "prod"], local.environment)
      error_message = "Select the dev or prod Terraform workspace before planning/applying."
    }
  }
}
