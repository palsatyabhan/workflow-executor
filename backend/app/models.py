from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


EngineType = Literal["n8n", "langflow"]


class InputField(BaseModel):
    key: str
    label: str
    field_type: Literal["string", "number", "boolean", "json"] = "string"
    required: bool = False
    default: Optional[Any] = None
    description: Optional[str] = None


class WorkflowImportResponse(BaseModel):
    workflow_id: str
    engine: EngineType
    name: str
    input_schema: List[InputField]
    runtime_config: Dict[str, Any] = Field(default_factory=dict)
    raw_json: Optional[Dict[str, Any]] = None


class WorkflowUpdateRequest(BaseModel):
    raw_json: Dict[str, Any]
    name: Optional[str] = None
    runtime_config: Dict[str, Any] = Field(default_factory=dict)


class RunRequest(BaseModel):
    inputs: Dict[str, Any] = Field(default_factory=dict)
    runtime_config: Dict[str, Any] = Field(default_factory=dict)


class RunResponse(BaseModel):
    workflow_id: str
    engine: EngineType
    status: Literal["running", "success", "failed", "dry_run"]
    message: str
    output: Dict[str, Any] = Field(default_factory=dict)


class StoredWorkflow(BaseModel):
    workflow_id: str
    engine: EngineType
    name: str
    raw_json: Dict[str, Any]
    input_schema: List[InputField]


class ImportJsonRequest(BaseModel):
    raw_json: Dict[str, Any]
    engine: Optional[EngineType] = None
    name: Optional[str] = None
    runtime_config: Dict[str, Any] = Field(default_factory=dict)


class UserAuthRequest(BaseModel):
    username: str
    password: str


class UserRegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class UserInfo(BaseModel):
    user_id: int
    username: str
    email: str


class AuthResponse(BaseModel):
    token: str
    user: UserInfo


class WorkflowListItem(BaseModel):
    workflow_id: str
    engine: EngineType
    name: str
    created_at: str


class ExecutionHistoryItem(BaseModel):
    execution_id: int
    workflow_id: str
    engine: EngineType
    status: Literal["running", "success", "failed", "dry_run"]
    stage: str = ""
    message: str
    created_at: str
    updated_at: str
    output: Dict[str, Any] = Field(default_factory=dict)
    inputs: Dict[str, Any] = Field(default_factory=dict)
    runtime_config: Dict[str, Any] = Field(default_factory=dict)
