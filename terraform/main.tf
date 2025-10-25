terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.1"
    }
  }
}

resource "null_resource" "create_kind_cluster" {
  provisioner "local-exec" {
    command = <<EOT
set -e
kind create cluster --name syvora-dev --config=./terraform/kind-config.yaml || true
kubectl cluster-info --context kind-syvora-dev
EOT
  }
}
