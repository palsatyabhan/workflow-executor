from __future__ import annotations

import re
from typing import Any, Dict, List, Set

from .models import EngineType, InputField


VAR_PATTERN = re.compile(r"\{\{\s*\$json\.([a-zA-Z0-9_]+)\s*\}\}")


def detect_engine(payload: Dict[str, Any]) -> EngineType:
    if "nodes" in payload and isinstance(payload.get("nodes"), list):
        return "n8n"
    if "data" in payload and isinstance(payload.get("data"), dict):
        # Typical Langflow export shape
        if "nodes" in payload["data"]:
            return "langflow"
    if "graph" in payload and isinstance(payload.get("graph"), dict):
        return "langflow"
    raise ValueError("Unknown workflow format. Expected n8n or Langflow JSON.")


def extract_name(payload: Dict[str, Any], engine: EngineType) -> str:
    if engine == "n8n":
        return str(payload.get("name") or "n8n-workflow")
    if engine == "langflow":
        if "name" in payload:
            return str(payload["name"])
        data = payload.get("data", {})
        if isinstance(data, dict) and "name" in data:
            return str(data["name"])
    return "workflow"


def extract_input_schema(payload: Dict[str, Any], engine: EngineType) -> List[InputField]:
    if engine == "n8n":
        return _extract_n8n_inputs(payload)
    return _extract_langflow_inputs(payload)


def _extract_n8n_inputs(payload: Dict[str, Any]) -> List[InputField]:
    fields: Dict[str, InputField] = {}
    nodes = payload.get("nodes", [])
    for node in nodes:
        parameters = node.get("parameters", {})
        _collect_from_any(parameters, fields)

    # Fallback for common webhook workflows where input is free-form.
    if not fields:
        fields["payload"] = InputField(
            key="payload",
            label="Payload (JSON)",
            field_type="json",
            required=True,
            description="Request payload passed to workflow",
            default={},
        )
    return list(fields.values())


def _extract_langflow_inputs(payload: Dict[str, Any]) -> List[InputField]:
    fields: Dict[str, InputField] = {}

    data = payload.get("data", {}) if isinstance(payload.get("data"), dict) else {}
    nodes = data.get("nodes", [])
    if isinstance(nodes, list):
        for node in nodes:
            _collect_from_any(node, fields)

    graph = payload.get("graph")
    if isinstance(graph, dict):
        _collect_from_any(graph, fields)

    # Langflow prompt-like input fallback
    if not fields:
        fields["input_value"] = InputField(
            key="input_value",
            label="Input",
            field_type="string",
            required=True,
            description="Primary input for the flow",
        )
    return list(fields.values())


def _collect_from_any(obj: Any, fields: Dict[str, InputField]) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            _capture_placeholder_vars(value, fields)
            # Also infer explicit input-ish keys
            if key in {"input", "prompt", "query", "text", "message"} and isinstance(value, str):
                if key not in fields:
                    fields[key] = InputField(
                        key=key,
                        label=key.replace("_", " ").title(),
                        field_type="string",
                        required=False,
                    )
            _collect_from_any(value, fields)
    elif isinstance(obj, list):
        for item in obj:
            _collect_from_any(item, fields)


def _capture_placeholder_vars(value: Any, fields: Dict[str, InputField]) -> None:
    if not isinstance(value, str):
        return
    keys: Set[str] = set(VAR_PATTERN.findall(value))
    for key in keys:
        if key not in fields:
            fields[key] = InputField(
                key=key,
                label=key.replace("_", " ").title(),
                field_type="string",
                required=True,
                description="Detected from workflow expression",
            )
