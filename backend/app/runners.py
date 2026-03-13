from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

from .models import EngineType, RunResponse, StoredWorkflow

logger = logging.getLogger("workflow_runtime.runners")


async def run_workflow(
    workflow: StoredWorkflow,
    inputs: Dict[str, Any],
    runtime_config: Dict[str, Any],
    on_stage: Optional[Callable[[str, str], Awaitable[None]]] = None,
) -> RunResponse:
    logger.info(
        "run_workflow_start workflow_id=%s engine=%s inputs=%s runtime_config=%s",
        workflow.workflow_id,
        workflow.engine,
        _safe_json_str(inputs),
        _safe_json_str(_mask_runtime_config(runtime_config)),
    )
    if workflow.engine == "n8n":
        return await _run_n8n(workflow, inputs, runtime_config, on_stage=on_stage)
    return await _run_langflow(workflow, inputs, runtime_config, on_stage=on_stage)


async def _run_n8n(
    workflow: StoredWorkflow,
    inputs: Dict[str, Any],
    runtime_config: Dict[str, Any],
    on_stage: Optional[Callable[[str, str], Awaitable[None]]] = None,
) -> RunResponse:
    webhook_url = runtime_config.get("n8n_webhook_url")
    if not webhook_url:
        logger.warning(
            "run_n8n_dry_run workflow_id=%s reason=no_webhook_url inputs=%s",
            workflow.workflow_id,
            _safe_json_str(inputs),
        )
        return RunResponse(
            workflow_id=workflow.workflow_id,
            engine="n8n",
            status="dry_run",
            message="No n8n webhook configured. Returning dry-run output.",
            output={"resolved_inputs": inputs},
        )

    started = time.perf_counter()
    if on_stage is not None:
        await on_stage("dispatching", "Sending request to n8n webhook.")
    logger.info(
        "run_n8n_request workflow_id=%s url=%s headers=%s body=%s",
        workflow.workflow_id,
        str(webhook_url),
        _safe_json_str({"Content-Type": "application/json"}),
        _safe_json_str(inputs),
    )
    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(str(webhook_url), json=inputs)
        if on_stage is not None:
            await on_stage("processing_response", "Received response from n8n. Processing output.")
        data = _safe_json(res)
        final_result = _extract_final_result(data)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "run_n8n_response workflow_id=%s status_code=%s elapsed_ms=%s body=%s",
            workflow.workflow_id,
            res.status_code,
            elapsed_ms,
            _safe_json_str(data),
        )
        return RunResponse(
            workflow_id=workflow.workflow_id,
            engine="n8n",
            status="success" if res.is_success else "failed",
            message=f"n8n webhook responded with {res.status_code}",
            output={
                "sent_inputs": inputs,
                "sent_payload": inputs,
                "final_result": final_result,
                "response": data,
                "status_code": res.status_code,
            },
        )


async def _run_langflow(
    workflow: StoredWorkflow,
    inputs: Dict[str, Any],
    runtime_config: Dict[str, Any],
    on_stage: Optional[Callable[[str, str], Awaitable[None]]] = None,
) -> RunResponse:
    langflow_url = runtime_config.get("langflow_run_url")
    api_key = runtime_config.get("langflow_api_key")
    if not langflow_url:
        logger.warning(
            "run_langflow_dry_run workflow_id=%s reason=no_run_url inputs=%s",
            workflow.workflow_id,
            _safe_json_str(inputs),
        )
        return RunResponse(
            workflow_id=workflow.workflow_id,
            engine="langflow",
            status="dry_run",
            message="No Langflow run URL configured. Returning dry-run output.",
            output={"resolved_inputs": inputs},
        )

    headers = {"Content-Type": "application/json"}
    if api_key:
        # Support both raw keys and "Bearer <token>" values from UI.
        normalized_key = str(api_key).strip()
        if normalized_key.lower().startswith("bearer "):
            normalized_key = normalized_key[7:].strip()
        headers["Authorization"] = f"Bearer {normalized_key}"
        headers["x-api-key"] = normalized_key

    request_body = {"inputs": inputs}
    # Langflow endpoint compatibility:
    # - some flows read top-level input_value/input_type/output_type
    # - nested `inputs` alone can be ignored depending on flow design
    if "input_value" in inputs:
        request_body["input_value"] = inputs["input_value"]
        request_body["input_type"] = runtime_config.get("langflow_input_type", "chat")
        request_body["output_type"] = runtime_config.get("langflow_output_type", "chat")
    elif len(inputs) == 1:
        only_value = next(iter(inputs.values()))
        if isinstance(only_value, str):
            request_body["input_value"] = only_value
            request_body["input_type"] = runtime_config.get("langflow_input_type", "chat")
            request_body["output_type"] = runtime_config.get("langflow_output_type", "chat")

    # Use a fresh session by default to avoid stale "continue conversation" behavior.
    request_body["session_id"] = runtime_config.get("langflow_session_id") or str(uuid.uuid4())
    started = time.perf_counter()
    if on_stage is not None:
        await on_stage("dispatching", "Sending request to Langflow endpoint.")
    logger.info(
        "run_langflow_request workflow_id=%s url=%s headers=%s body=%s",
        workflow.workflow_id,
        str(langflow_url),
        _safe_json_str(_mask_headers(headers)),
        _safe_json_str(request_body),
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(str(langflow_url), headers=headers, json=request_body)
        if on_stage is not None:
            await on_stage("processing_response", "Received response from Langflow. Processing output.")
        data = _safe_json(res)
        final_result = _extract_final_result(data)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "run_langflow_response workflow_id=%s status_code=%s elapsed_ms=%s body=%s",
            workflow.workflow_id,
            res.status_code,
            elapsed_ms,
            _safe_json_str(data),
        )
        return RunResponse(
            workflow_id=workflow.workflow_id,
            engine="langflow",
            status="success" if res.is_success else "failed",
            message=f"Langflow endpoint responded with {res.status_code}",
            output={
                "sent_inputs": inputs,
                "sent_payload": request_body,
                "final_result": final_result,
                "response": data,
                "status_code": res.status_code,
            },
        )


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text}


def _safe_json_str(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return str(value)


def _mask_headers(headers: Dict[str, Any]) -> Dict[str, Any]:
    masked = dict(headers)
    if "Authorization" in masked:
        masked["Authorization"] = _mask_token(str(masked["Authorization"]))
    if "x-api-key" in masked:
        masked["x-api-key"] = _mask_token(str(masked["x-api-key"]))
    return masked


def _mask_runtime_config(runtime_config: Dict[str, Any]) -> Dict[str, Any]:
    masked = dict(runtime_config)
    if "langflow_api_key" in masked:
        masked["langflow_api_key"] = _mask_token(str(masked["langflow_api_key"]))
    return masked


def _mask_token(token: str) -> str:
    cleaned = token.strip()
    if len(cleaned) <= 8:
        return "***"
    return f"{cleaned[:4]}...{cleaned[-4:]}"


def _extract_final_result(data: Any) -> str:
    # Try common Langflow/n8n output paths first.
    if isinstance(data, dict):
        candidates = [
            data.get("text"),
            data.get("message"),
            data.get("result"),
            data.get("output"),
        ]
        for value in candidates:
            if isinstance(value, str) and value.strip():
                return value.strip()

        # Langflow response shape.
        outputs = data.get("outputs")
        if isinstance(outputs, list):
            for block in outputs:
                if not isinstance(block, dict):
                    continue
                nested_outputs = block.get("outputs")
                if not isinstance(nested_outputs, list):
                    continue
                for nested in nested_outputs:
                    if not isinstance(nested, dict):
                        continue
                    msg = (
                        nested.get("outputs", {})
                        .get("message", {})
                        .get("message")
                    )
                    if isinstance(msg, str) and msg.strip():
                        return msg.strip()
                    msg2 = (
                        nested.get("results", {})
                        .get("message", {})
                        .get("text")
                    )
                    if isinstance(msg2, str) and msg2.strip():
                        return msg2.strip()

    # Final fallback: recursive first non-empty string search.
    found = _first_non_empty_string(data)
    return found or ""


def _first_non_empty_string(value: Any) -> str:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped
    if isinstance(value, dict):
        for item in value.values():
            found = _first_non_empty_string(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = _first_non_empty_string(item)
            if found:
                return found
    return ""
