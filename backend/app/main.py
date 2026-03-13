from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import sqlite3
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import (
    authenticate_user,
    create_session,
    create_user,
    delete_workflow,
    delete_execution,
    delete_session,
    get_execution,
    get_user_by_email,
    get_user_by_token,
    get_workflow,
    init_db,
    list_executions,
    list_workflows,
    save_execution,
    save_workflow,
    update_execution,
)
from .models import (
    AuthResponse,
    ExecutionHistoryItem,
    ImportJsonRequest,
    RunRequest,
    StoredWorkflow,
    UserAuthRequest,
    UserRegisterRequest,
    UserInfo,
    WorkflowImportResponse,
    WorkflowListItem,
)
from .parsers import detect_engine, extract_input_schema, extract_name
from .runners import run_workflow

app = FastAPI(title="Workflow Runtime Studio")
logger = logging.getLogger("workflow_runtime.api")
BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
UI_DIR = PROJECT_ROOT / "ui"
UI_DIST_DIR = UI_DIR / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if UI_DIST_DIR.exists():
    assets_dir = UI_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")


@app.on_event("startup")
async def startup_event() -> None:
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
    init_db()
    logger.info("application_startup complete")


@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    started = time.perf_counter()
    logger.info(
        "http_request_start request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path,
    )
    try:
        response = await call_next(request)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "http_request_end request_id=%s method=%s path=%s status=%s elapsed_ms=%s",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response
    except Exception:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.exception(
            "http_request_error request_id=%s method=%s path=%s elapsed_ms=%s",
            request_id,
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise


@app.get("/")
async def index():
    index_file = UI_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "message": "Workflow Runtime Studio API is running.",
        "ui_dev": "Run React UI with: cd ui && npm install && npm run dev",
    }


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header.")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token.")
    token = parts[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token.")
    return token


def get_current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    token = _extract_bearer_token(authorization)
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return {"token": token, **user}


@app.post("/api/auth/register", response_model=AuthResponse)
async def register(request: UserRegisterRequest) -> AuthResponse:
    username = request.username.strip()
    email = request.email.strip().lower()
    password = request.password.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required.")
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email is required.")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if get_user_by_email(email):
        raise HTTPException(status_code=409, detail="User already exists.")

    try:
        user = create_user(username, email, password)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="User already exists.") from exc

    token = create_session(user["user_id"])
    return AuthResponse(token=token, user=UserInfo(**user))


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(request: UserAuthRequest) -> AuthResponse:
    user = authenticate_user(request.username, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_session(user["user_id"])
    return AuthResponse(token=token, user=UserInfo(**user))


@app.get("/api/auth/me", response_model=UserInfo)
async def me(current_user: Dict[str, Any] = Depends(get_current_user)) -> UserInfo:
    return UserInfo(
        user_id=int(current_user["user_id"]),
        username=str(current_user["username"]),
        email=str(current_user["email"]),
    )


@app.post("/api/auth/logout")
async def logout(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, str]:
    delete_session(str(current_user["token"]))
    return {"message": "Logged out successfully."}


def _import_workflow_payload(
    payload: Dict[str, Any],
    user_id: int,
    provided_name: Optional[str] = None,
    expected_engine: Optional[str] = None,
    runtime_config: Optional[Dict[str, Any]] = None,
) -> WorkflowImportResponse:
    try:
        engine = detect_engine(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if expected_engine is not None and expected_engine != engine:
        raise HTTPException(
            status_code=400,
            detail=f"Provided engine '{expected_engine}' does not match detected engine '{engine}'.",
        )

    workflow_id = str(uuid.uuid4())
    name = provided_name.strip() if provided_name else extract_name(payload, engine)
    input_schema = extract_input_schema(payload, engine)
    normalized_runtime = _normalize_runtime_config(runtime_config or {})
    _validate_runtime_config(engine, normalized_runtime)
    save_workflow(
        workflow_id=workflow_id,
        user_id=user_id,
        engine=engine,
        name=name,
        raw_json=payload,
        input_schema=[item.model_dump() for item in input_schema],
        runtime_config=normalized_runtime,
    )
    return WorkflowImportResponse(
        workflow_id=workflow_id,
        engine=engine,
        name=name,
        input_schema=input_schema,
        runtime_config=normalized_runtime,
    )


def _normalize_runtime_config(runtime_config: Dict[str, Any]) -> Dict[str, Any]:
    cleaned: Dict[str, Any] = {}
    for key in ("n8n_webhook_url", "langflow_run_url", "langflow_api_key"):
        value = runtime_config.get(key)
        if value is None:
            continue
        normalized = str(value).strip()
        if normalized:
            cleaned[key] = normalized
    return cleaned


def _validate_runtime_config(engine: str, runtime_config: Dict[str, Any]) -> None:
    if engine == "n8n":
        if not runtime_config.get("n8n_webhook_url"):
            raise HTTPException(
                status_code=400,
                detail="n8n webhook URL is required while registering n8n workflow.",
            )
    if engine == "langflow":
        if not runtime_config.get("langflow_run_url"):
            raise HTTPException(
                status_code=400,
                detail="Langflow run URL is required while registering langflow workflow.",
            )
        if not runtime_config.get("langflow_api_key"):
            raise HTTPException(
                status_code=400,
                detail="Langflow API key is required while registering langflow workflow.",
            )


def _to_execution_history_item(item: Dict[str, Any]) -> ExecutionHistoryItem:
    return ExecutionHistoryItem(
        execution_id=item["execution_id"],
        workflow_id=item["workflow_id"],
        engine=item["engine"],
        status=item["status"],
        stage=item.get("stage", ""),
        message=item["message"],
        created_at=item["created_at"],
        updated_at=item.get("updated_at", item["created_at"]),
        output=item["output"],
        inputs=item["inputs"],
        runtime_config=item["runtime_config"],
    )


async def _execute_workflow_job(
    *,
    execution_id: int,
    user_id: int,
    workflow: StoredWorkflow,
    inputs: Dict[str, Any],
    runtime_config: Dict[str, Any],
) -> None:
    async def _on_stage(stage: str, message: str) -> None:
        update_execution(
            user_id=user_id,
            execution_id=execution_id,
            status="running",
            stage=stage,
            message=message,
            output={},
        )

    try:
        result = await run_workflow(workflow, inputs, runtime_config, on_stage=_on_stage)
        final_stage = "completed" if result.status in {"success", "dry_run"} else "failed"
        update_execution(
            user_id=user_id,
            execution_id=execution_id,
            status=result.status,
            stage=final_stage,
            message=result.message,
            output=result.output,
        )
    except Exception as exc:
        logger.exception(
            "workflow_run_background_error user_id=%s workflow_id=%s execution_id=%s",
            user_id,
            workflow.workflow_id,
            execution_id,
        )
        update_execution(
            user_id=user_id,
            execution_id=execution_id,
            status="failed",
            stage="failed",
            message=f"Execution failed: {exc}",
            output={"error": str(exc)},
        )


@app.post("/api/workflows/import", response_model=WorkflowImportResponse)
async def import_workflow_file(
    file: UploadFile = File(...),
    n8n_webhook_url: Optional[str] = Form(default=None),
    langflow_run_url: Optional[str] = Form(default=None),
    langflow_api_key: Optional[str] = Form(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> WorkflowImportResponse:
    logger.info(
        "workflow_import_file_start user_id=%s filename=%s",
        current_user["user_id"],
        file.filename,
    )
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Please upload a JSON file.")
    raw_bytes = await file.read()
    try:
        payload = json.loads(raw_bytes.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file: {exc}") from exc

    response = _import_workflow_payload(
        payload,
        int(current_user["user_id"]),
        runtime_config={
            "n8n_webhook_url": n8n_webhook_url,
            "langflow_run_url": langflow_run_url,
            "langflow_api_key": langflow_api_key,
        },
    )
    logger.info(
        "workflow_import_file_end user_id=%s workflow_id=%s engine=%s",
        current_user["user_id"],
        response.workflow_id,
        response.engine,
    )
    return response


@app.post("/api/workflows/import-json", response_model=WorkflowImportResponse)
async def import_workflow_json(
    request: ImportJsonRequest, current_user: Dict[str, Any] = Depends(get_current_user)
) -> WorkflowImportResponse:
    logger.info("workflow_import_json_start user_id=%s", current_user["user_id"])
    if not isinstance(request.raw_json, dict):
        raise HTTPException(status_code=400, detail="raw_json must be a JSON object.")
    response = _import_workflow_payload(
        request.raw_json,
        int(current_user["user_id"]),
        provided_name=request.name,
        expected_engine=request.engine,
        runtime_config=request.runtime_config,
    )
    logger.info(
        "workflow_import_json_end user_id=%s workflow_id=%s engine=%s",
        current_user["user_id"],
        response.workflow_id,
        response.engine,
    )
    return response


@app.get("/api/workflows", response_model=List[WorkflowListItem])
async def get_workflows(
    engine: Optional[str] = Query(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> List[WorkflowListItem]:
    if engine is not None and engine not in {"n8n", "langflow"}:
        raise HTTPException(status_code=400, detail="Engine must be n8n or langflow.")
    data = list_workflows(int(current_user["user_id"]), engine)
    return [WorkflowListItem(**item) for item in data]


@app.get("/api/workflows/{workflow_id}", response_model=WorkflowImportResponse)
async def get_workflow_by_id(
    workflow_id: str, current_user: Dict[str, Any] = Depends(get_current_user)
) -> WorkflowImportResponse:
    row = get_workflow(int(current_user["user_id"]), workflow_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    return WorkflowImportResponse(
        workflow_id=row["workflow_id"],
        engine=row["engine"],
        name=row["name"],
        input_schema=row["input_schema"],
        runtime_config=row.get("runtime_config", {}),
    )


@app.delete("/api/workflows/{workflow_id}")
async def remove_workflow(
    workflow_id: str, current_user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, str]:
    removed = delete_workflow(int(current_user["user_id"]), workflow_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    return {"message": "Workflow deleted."}


@app.post("/api/workflows/{workflow_id}/run")
async def run_imported_workflow(
    workflow_id: str, request: RunRequest, current_user: Dict[str, Any] = Depends(get_current_user)
):
    logger.info(
        "workflow_run_start user_id=%s workflow_id=%s inputs=%s runtime_config=%s",
        current_user["user_id"],
        workflow_id,
        _safe_json_str(request.inputs),
        _safe_json_str(_mask_runtime_config(request.runtime_config)),
    )
    row = get_workflow(int(current_user["user_id"]), workflow_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found.")

    workflow = StoredWorkflow(
        workflow_id=row["workflow_id"],
        engine=row["engine"],
        name=row["name"],
        raw_json=row["raw_json"],
        input_schema=row["input_schema"],
    )
    merged_runtime_config = {
        **(row.get("runtime_config", {}) or {}),
        **_normalize_runtime_config(request.runtime_config),
    }
    execution_id = save_execution(
        workflow_id=workflow.workflow_id,
        user_id=int(current_user["user_id"]),
        engine=workflow.engine,
        status="running",
        stage="queued",
        message="Execution started. Queued for processing.",
        output={},
        inputs=request.inputs,
        runtime_config=merged_runtime_config,
    )
    task = asyncio.create_task(
        _execute_workflow_job(
            execution_id=execution_id,
            user_id=int(current_user["user_id"]),
            workflow=workflow,
            inputs=request.inputs,
            runtime_config=merged_runtime_config,
        )
    )
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    logger.info(
        "workflow_run_queued user_id=%s workflow_id=%s execution_id=%s",
        current_user["user_id"],
        workflow_id,
        execution_id,
    )
    return {
        "execution_id": execution_id,
        "workflow_id": workflow.workflow_id,
        "engine": workflow.engine,
        "status": "running",
        "stage": "queued",
        "message": "Execution started. Poll execution status for live progress.",
        "output": {},
    }


@app.get("/api/executions", response_model=List[ExecutionHistoryItem])
async def get_executions(
    workflow_id: Optional[str] = Query(default=None),
    engine: Optional[str] = Query(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user),
) -> List[ExecutionHistoryItem]:
    if engine is not None and engine not in {"n8n", "langflow"}:
        raise HTTPException(status_code=400, detail="Engine must be n8n or langflow.")
    rows = list_executions(
        int(current_user["user_id"]),
        workflow_id=workflow_id,
        engine=engine,
    )
    return [_to_execution_history_item(item) for item in rows]


@app.get("/api/executions/{execution_id}", response_model=ExecutionHistoryItem)
async def get_execution_by_id(
    execution_id: int, current_user: Dict[str, Any] = Depends(get_current_user)
) -> ExecutionHistoryItem:
    item = get_execution(int(current_user["user_id"]), execution_id)
    if not item:
        raise HTTPException(status_code=404, detail="Execution not found.")
    return _to_execution_history_item(item)


@app.post("/api/executions/{execution_id}/rerun")
async def rerun_execution(execution_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    logger.info("execution_rerun_start user_id=%s execution_id=%s", current_user["user_id"], execution_id)
    existing = get_execution(int(current_user["user_id"]), execution_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Execution not found.")
    workflow_row = get_workflow(int(current_user["user_id"]), existing["workflow_id"])
    if not workflow_row:
        raise HTTPException(status_code=404, detail="Original workflow not found.")

    workflow = StoredWorkflow(
        workflow_id=workflow_row["workflow_id"],
        engine=workflow_row["engine"],
        name=workflow_row["name"],
        raw_json=workflow_row["raw_json"],
        input_schema=workflow_row["input_schema"],
    )
    new_execution_id = save_execution(
        workflow_id=workflow.workflow_id,
        user_id=int(current_user["user_id"]),
        engine=workflow.engine,
        status="running",
        stage="queued",
        message="Rerun started. Queued for processing.",
        output={},
        inputs=existing["inputs"],
        runtime_config=existing["runtime_config"],
    )
    task = asyncio.create_task(
        _execute_workflow_job(
            execution_id=new_execution_id,
            user_id=int(current_user["user_id"]),
            workflow=workflow,
            inputs=existing["inputs"],
            runtime_config=existing["runtime_config"],
        )
    )
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    logger.info(
        "execution_rerun_queued user_id=%s source_execution_id=%s new_execution_id=%s",
        current_user["user_id"],
        execution_id,
        new_execution_id,
    )
    return {
        "execution_id": new_execution_id,
        "workflow_id": workflow.workflow_id,
        "engine": workflow.engine,
        "status": "running",
        "stage": "queued",
        "message": "Rerun started. Poll execution status for live progress.",
        "output": {},
    }


@app.delete("/api/executions/{execution_id}")
async def remove_execution(execution_id: int, current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, str]:
    removed = delete_execution(int(current_user["user_id"]), execution_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Execution not found.")
    return {"message": "Execution deleted."}


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    index_file = UI_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Route not found")


def _safe_json_str(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return str(value)


def _mask_runtime_config(runtime_config: Dict[str, Any]) -> Dict[str, Any]:
    masked = dict(runtime_config)
    if "langflow_api_key" in masked and masked["langflow_api_key"] is not None:
        token = str(masked["langflow_api_key"]).strip()
        if len(token) <= 8:
            masked["langflow_api_key"] = "***"
        else:
            masked["langflow_api_key"] = f"{token[:4]}...{token[-4:]}"
    return masked
