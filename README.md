# Workflow Runtime Studio (n8n + Langflow)

This project is a starter for an enterprise-style platform where users can:

1. Upload an `n8n` or `Langflow` workflow JSON
2. Auto-generate a runnable input UI from detected variables
3. Run the workflow with user-provided inputs
4. Capture execution output and status

## What is implemented

- FastAPI backend with:
  - User register/login/logout
  - SQLite persistence for users, workflows, sessions, and executions
  - Workflow import endpoint
  - Engine auto-detection (`n8n` / `langflow`)
  - Input schema extraction from JSON
  - Unified run endpoint
  - Workflow list and run history endpoints
- Web UI (React + Vite) with:
  - Home/product section
  - Login/Register forms
  - JSON upload and JSON paste import options
  - Engine filter and old imported workflow list
  - Run history list with output preview
  - Auto-generated form fields
  - Run action and output viewer

## Project structure

```text
backend/
  app/
    main.py
    db.py
    models.py
    parsers.py
    runners.py
  requirements.txt
  app.db
ui/
  package.json
  index.html
  src/
    App.jsx
    main.jsx
    styles.css
```

## Quick start

```bash
make setup
make setup-ui
make run
make run-ui
```

Open UI: `http://localhost:5173`
Backend API: `http://localhost:8000`

## API

- `POST /api/auth/register`
  - JSON body: `{ "username": "...", "email": "...", "password": "..." }`
- `POST /api/auth/login`
  - JSON body: `{ "username": "...", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

- `POST /api/workflows/import`
  - multipart form: `file=<workflow.json>`
  - multipart form also accepts:
    - `n8n_webhook_url`
    - `langflow_run_url`
    - `langflow_api_key`
  - returns `{ workflow_id, engine, name, input_schema }`
- `POST /api/workflows/import-json`
  - JSON body: `{ "raw_json": {...}, "engine": "n8n|langflow|null", "name": "...", "runtime_config": {...} }`
- `GET /api/workflows?engine=n8n|langflow`
- `GET /api/workflows/{workflow_id}`
- `DELETE /api/workflows/{workflow_id}`
- `POST /api/workflows/{workflow_id}/run`
  - JSON body: `{ "inputs": { ... }, "runtime_config": { ... } }`
  - returns unified execution result
- `GET /api/executions?workflow_id=<optional>&engine=<optional n8n|langflow>`
- `POST /api/executions/{execution_id}/rerun`
- `DELETE /api/executions/{execution_id}`
- `GET /health`

## Enterprise hardening checklist

Use this starter as the runtime layer and add:

- Authentication & authorization (OIDC/SAML, RBAC/ABAC)
- Multi-tenancy boundaries and per-tenant data isolation
- Secret vault integration (AWS Secrets Manager / Vault)
- Persistent storage (Postgres) for workflows + execution history
- Queue workers (Celery/RQ/Kafka) for long-running executions
- Retry policies, idempotency keys, circuit breakers
- Auditing, PII masking, immutable logs
- Rate limits and WAF
- Input validation policy and schema versioning
- Observability (OpenTelemetry traces, metrics, dashboards)

## Important notes

- `n8n` and `Langflow` execution can be done in multiple ways depending on deployment.
- This starter supports adapter-style execution:
  - n8n: trigger webhook or custom endpoint
  - Langflow: call flow endpoint/API
- If endpoints are not configured, the app returns a dry-run response with resolved inputs.
