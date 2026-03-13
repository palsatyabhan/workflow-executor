# Workflow Runtime Studio (n8n + Langflow)

Enterprise-style workflow control plane for registering, executing, and tracking `n8n` and `Langflow` JSON workflows with auth, runtime configuration, and execution governance.

## What is implemented

### Backend (FastAPI + SQLite)

- Session auth: register, login, logout, current-user profile.
- Workflow registry:
  - import from file upload or raw JSON
  - engine auto-detection (`n8n` / `langflow`)
  - extracted input schema persistence
  - engine-specific runtime config validation at registration time
- Execution engine:
  - async run queue behavior with immediate `running` status
  - live stage tracking (`queued`, `dispatching`, `processing_response`, `completed`, `failed`)
  - persisted execution audit data (inputs, runtime config, output, status, stage, timestamps)
- History APIs with filtering and single-execution lookup.
- Structured request/execution logging with sensitive key masking.

### UI (React + Vite)

- Enterprise dashboard layout with auth flows and workspace navigation.
- Register workflow page:
  - upload JSON or paste JSON
  - conditional runtime fields for n8n vs Langflow
- Run workflow page:
  - auto-loaded input schema from selected workflow
  - dynamic input form rendering
  - live execution polling for running status/stage
  - clean output panel (shows empty state when no output exists)
- History dashboard:
  - compact table with workflow name + ID
  - stage + status visibility
  - filter, search, sorting (including clickable column sorting), pagination
  - rerun and delete actions
  - output panel at bottom with processed/full response toggle
- Branding/icons:
  - official n8n and Langflow logos integrated across key views
  - dark/light mode toggle

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
  app.db                    # created at runtime
ui/
  package.json
  package-lock.json
  index.html
  src/
    App.jsx
    main.jsx
    styles.css
    assets/
      n8n-logo.svg
      langflow-logo.svg
Makefile
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

### Auth

- `POST /api/auth/register`
  - body: `{ "username": "...", "email": "...", "password": "..." }`
- `POST /api/auth/login`
  - body: `{ "username": "...", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Workflows

- `POST /api/workflows/import`
  - multipart form: `file=<workflow.json>`
  - optional runtime fields:
    - `n8n_webhook_url`
    - `langflow_run_url`
    - `langflow_api_key`
- `POST /api/workflows/import-json`
  - body:
    - `{ "raw_json": {...}, "engine": "n8n|langflow|null", "name": "...", "runtime_config": {...} }`
- `GET /api/workflows?engine=n8n|langflow`
- `GET /api/workflows/{workflow_id}`
- `DELETE /api/workflows/{workflow_id}`

### Executions

- `POST /api/workflows/{workflow_id}/run`
  - body: `{ "inputs": {...}, "runtime_config": {...} }`
  - returns queued/running execution envelope with `execution_id`
- `GET /api/executions?workflow_id=<optional>&engine=<optional n8n|langflow>`
- `GET /api/executions/{execution_id}`
- `POST /api/executions/{execution_id}/rerun`
- `DELETE /api/executions/{execution_id}`

### Health

- `GET /health`

## Current execution status model

- `running`: execution started and still in progress
- `success`: external engine returned successful response
- `failed`: external engine or processing failed
- `dry_run`: runtime endpoint was not configured, so request was resolved only

## Notes

- n8n is executed via webhook URL.
- Langflow is executed via run URL + API key (supports `Authorization` and `x-api-key`).
- Runtime configuration is stored at registration and reused at run time.
- Local artifacts (`.app.log`, `.app.pid`, `ui/dist`, `ui/node_modules`, `backend/app.db`) are ignored via `.gitignore`.
