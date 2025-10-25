# DevOps Technical Assignment

## Overview

This repository contains a complete, opinionated solution for the Syvora DevOps technical assignment. It aims to be easy to run locally, CI-driven for image builds, and deployable to Kubernetes using Helm. It also includes monitoring via Prometheus (with alerting) for the backend service.

### What you get

* A simple **Node.js** backend (CRUD API) using **Express** and **Postgres** as the database.
* Dockerized application and `docker-compose.yml` for local development (app + database).
* GitHub Actions workflow to build and push Docker image to Docker Hub on `main` branch.
* Terraform script to create a **local Kind** Kubernetes cluster (so this is reproducible locally) and to ensure `kubectl` context exists.
* A **Helm chart** to deploy the backend into Kubernetes.
* Prometheus monitoring via `kube-prometheus-stack` Helm chart with a scrape config for the app metrics and an example alert rule (high response time / unavailable).

---

## Repository structure (recommended)

```
/ (repo root)
├─ app/                      # Node.js app source
│  ├─ src/
│  │  ├─ index.js
│  │  ├─ routes.js
│  │  └─ metrics.js
│  ├─ package.json
│  └─ Dockerfile
├─ docker-compose.yml
├─ helm-chart/               # Helm chart for the backend
│  ├─ Chart.yaml
│  ├─ values.yaml
│  └─ templates/
│     ├─ deployment.yaml
│     ├─ service.yaml
│     └─ _helpers.tpl
├─ terraform/
│  ├─ main.tf
│  └─ kind-config.yaml
├─ k8s/                      # Optional: k8s manifests (if not using helm)
├─ .github/workflows/ci.yml  # GitHub Actions workflow to build & push image
└─ README.md
```

---

## Prerequisites

* Docker (and docker-compose)
* kind (for the local k8s cluster) — or you can use Docker Desktop Kubernetes
* kubectl
* helm
* terraform
* GitHub account + Docker Hub account (for CI image push)

> Note: The Terraform provided uses `local-exec` to create a Kind cluster so you won't need cloud provider credentials. If you prefer a cloud cluster (EKS/GKE/AKS) adapt the Terraform accordingly.

---

## 1) Run locally using docker-compose

1. Copy `.env.example` → `.env` and set values (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB).
2. Start services:

```bash
docker-compose up --build
```

3. API endpoints

* `GET  /items` — list items
* `GET  /items/:id` — get item
* `POST /items` — create item (json: {"name":"...","desc":"..."})
* `PUT  /items/:id` — update item
* `DELETE /items/:id` — delete item

4. Metrics (Prometheus): `GET /metrics`

---

## 2) Dockerfile (app)

A sample Dockerfile (placed at `app/Dockerfile`):

```Dockerfile
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node","src/index.js"]
```

(Development builds can use `npm install` and `NODE_ENV=development`.)

---

## 3) GitHub Actions — build & push image

Save this as `.github/workflows/ci.yml`. It triggers on `push` to `main` and builds and pushes to Docker Hub.

```yaml
name: CI - Build & Push
on:
  push:
    branches: [ main ]
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v2
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Login to DockerHub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ./app
          push: true
          tags: ${{ secrets.DOCKERHUB_USERNAME }}/syvora-backend:latest
```

**Secrets required** in repository settings:

* `DOCKERHUB_USERNAME`
* `DOCKERHUB_TOKEN` (Docker Hub access token)

Optionally you can add image tags using commit SHA or Git tags.

---

## 4) Terraform — create local Kind cluster

File: `terraform/main.tf`

```hcl
terraform {
  required_providers {}
}

resource "null_resource" "create_kind" {
  provisioner "local-exec" {
    command = <<EOT
kind create cluster --name syvora-dev --config=./terraform/kind-config.yaml || true
kubectl cluster-info --context kind-syvora-dev
EOT
  }
}
```

`terraform/kind-config.yaml` can be a basic kind config — included in the repo. Running `terraform init && terraform apply -auto-approve` will create the cluster locally.

> If you prefer Docker Desktop or an existing cluster, skip terraform and ensure your kubeconfig points to the cluster.

---

## 5) Helm chart — deploy backend

The Helm chart is under `helm-chart/`.

### Example deployment values (in `values.yaml`):

```yaml
replicaCount: 1
image:
  repository: DOCKERHUB_USERNAME/syvora-backend
  tag: "latest"
service:
  type: ClusterIP
  port: 3000
resources: {}
```

### Install steps (after cluster exists and kubeconfig is set):

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack for monitoring
helm install prometheus prometheus-community/kube-prometheus-stack --namespace monitoring --create-namespace -f helm-chart/prom-values.yaml

# Install the backend app
helm install syvora-backend ./helm-chart -n syvora --create-namespace -f helm-chart/values.yaml
```

The chart's `deployment.yaml` will include a liveness/readiness probe and an annotation so Prometheus can autodiscover the `/metrics` endpoint.

---

## 6) Monitoring & Alerts

We use `kube-prometheus-stack` which includes Prometheus, Alertmanager, and Grafana.

### App metrics

The Node.js app exposes Prometheus metrics at `/metrics` (using `prom-client`). The Helm chart contains the proper `ServiceMonitor` (or pod annotations) so Prometheus scrapes the app.

### Example alert rules

Create `ServiceMonitor` and PrometheusRule with alerts (example):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: syvora-rules
  namespace: monitoring
spec:
  groups:
  - name: syvora.rules
    rules:
    - alert: SrvUnresponsive
      expr: up{job="syvora-backend"} == 0
      for: 1m
      labels:
        severity: critical
      annotations:
        summary: "syvora backend is down"
    - alert: HighResponseTime
      expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{job="syvora-backend"}[5m])) by (le)) > 0.5
      for: 2m
      labels:
        severity: warning
      annotations:
        summary: "High 95th percentile response time (>0.5s)"
```

Adjust thresholds per your latency expectations. The example above uses a histogram exported by the app (see `prom-client` histogram usage in the Node code).

---

## 7) Files to include in the repo (copy/paste-ready examples)

* `app/src/index.js` — Express app with routes + prom-client instrumentation.
* `app/Dockerfile` — to build the image.
* `docker-compose.yml` — to run local Postgres + backend.
* `helm-chart/*` — Chart files for deployment.
* `terraform/*` — Terraform scripts to create local kind cluster.
* `.github/workflows/ci.yml` — CI workflow.

I can provide the exact contents for each file (Node app files, Helm template files, Terraform files and GitHub Actions) as ready-to-copy code in this repo. I intentionally left placeholders for secrets and your Docker Hub username so you can easily adapt them.

---

## Extra notes & suggestions

* **Database migrations**: For production you'd add migrations (e.g., using `knex`, `sequelize` or `flyway`). In this small assignment it's acceptable to create the table at application start.
* **Image tags**: Tag images with both `latest` and `sha-<short>` for traceability.
* **Security**: Do not store secrets in repo — use Kubernetes Secrets or external secret managers.
* **CI → CD**: If you want, extend GitHub Actions to `kubectl apply`/`helm upgrade --install` when pushing to a `staging` branch, provided you store kubeconfig in secrets.

---

## If you want, next steps I can do for you now

* Paste full code for `app/src/index.js`, `metrics.js` and `package.json`.
* Paste `docker-compose.yml` and `app/Dockerfile` contents.
* Paste the Helm chart templates (`deployment.yaml`, `service.yaml`, `Chart.yaml`, `values.yaml`).
* Paste Terraform `main.tf` and `kind-config.yaml`.
* Paste GitHub Actions workflow.

Tell me which files you want me to add directly into the repo content next and I will provide them ready-to-copy (I'll include the PrometheusRule and ServiceMonitor YAML too).
