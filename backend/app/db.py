from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("APP_DB_PATH", str(BACKEND_DIR / "app.db")))


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            engine TEXT NOT NULL,
            name TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            input_schema TEXT NOT NULL,
            runtime_config_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            engine TEXT NOT NULL,
            status TEXT NOT NULL,
            stage TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL,
            output_json TEXT NOT NULL,
            inputs_json TEXT NOT NULL DEFAULT '{}',
            runtime_config_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT '',
            FOREIGN KEY(workflow_id) REFERENCES workflows(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    _ensure_column(cur, "users", "username", "TEXT")
    _ensure_column(cur, "workflows", "runtime_config_json", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(cur, "executions", "inputs_json", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(cur, "executions", "runtime_config_json", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(cur, "executions", "stage", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(cur, "executions", "updated_at", "TEXT NOT NULL DEFAULT ''")
    conn.commit()
    _backfill_usernames(cur)
    conn.commit()
    conn.close()


def _ensure_column(cur: sqlite3.Cursor, table: str, column: str, column_sql: str) -> None:
    cur.execute(f"PRAGMA table_info({table})")
    columns = [str(r[1]) for r in cur.fetchall()]
    if column not in columns:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_sql}")


def _backfill_usernames(cur: sqlite3.Cursor) -> None:
    cur.execute("SELECT id, email, username FROM users")
    rows = cur.fetchall()
    for row in rows:
        if row["username"]:
            continue
        email = str(row["email"])
        base = email.split("@", 1)[0] if "@" in email else f"user{row['id']}"
        username = _make_unique_username(cur, base.strip() or f"user{row['id']}")
        cur.execute("UPDATE users SET username = ? WHERE id = ?", (username, int(row["id"])))


def _make_unique_username(cur: sqlite3.Cursor, base: str) -> str:
    candidate = base.lower().replace(" ", "_")
    if not candidate:
        candidate = "user"
    suffix = 0
    while True:
        probe = candidate if suffix == 0 else f"{candidate}{suffix}"
        cur.execute("SELECT 1 FROM users WHERE username = ? LIMIT 1", (probe,))
        if cur.fetchone() is None:
            return probe
        suffix += 1


def _hash_password(password: str, salt_hex: str) -> str:
    salt = bytes.fromhex(salt_hex)
    value = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 150000)
    return value.hex()


def create_user(username: str, email: str, password: str) -> Dict[str, Any]:
    salt_hex = secrets.token_hex(16)
    hashed = _hash_password(password, salt_hex)
    conn = get_conn()
    cur = conn.cursor()
    username_final = _make_unique_username(cur, username)
    cur.execute(
        "INSERT INTO users(username, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)",
        (username_final, email.lower().strip(), hashed, salt_hex, utcnow_iso()),
    )
    conn.commit()
    user_id = cur.lastrowid
    conn.close()
    return {"user_id": int(user_id), "username": username_final, "email": email.lower().strip()}


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, username, email, password_hash, salt FROM users WHERE email = ?",
        (email.lower().strip(),),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return dict(row)


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, username, email, password_hash, salt FROM users WHERE username = ?",
        (username.strip().lower(),),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return dict(row)


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    user = get_user_by_username(username)
    if not user:
        return None
    expected = _hash_password(password, user["salt"])
    if secrets.compare_digest(expected, user["password_hash"]):
        return {
            "user_id": int(user["id"]),
            "username": str(user["username"]),
            "email": str(user["email"]),
        }
    return None


def create_session(user_id: int, days: int = 30) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=days)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now.isoformat(), expires.isoformat()),
    )
    conn.commit()
    conn.close()
    return token


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT u.id, u.username, u.email, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        return None

    expires_at = datetime.fromisoformat(str(row["expires_at"]))
    if datetime.now(timezone.utc) >= expires_at:
        cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
        return None

    conn.close()
    return {
        "user_id": int(row["id"]),
        "username": str(row["username"]),
        "email": str(row["email"]),
    }


def delete_session(token: str) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def save_workflow(
    workflow_id: str,
    user_id: int,
    engine: str,
    name: str,
    raw_json: Dict[str, Any],
    input_schema: List[Dict[str, Any]],
    runtime_config: Dict[str, Any],
) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO workflows(id, user_id, engine, name, raw_json, input_schema, runtime_config_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            workflow_id,
            user_id,
            engine,
            name,
            json.dumps(raw_json),
            json.dumps(input_schema),
            json.dumps(runtime_config),
            utcnow_iso(),
        ),
    )
    conn.commit()
    conn.close()


def list_workflows(user_id: int, engine: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    if engine:
        cur.execute(
            "SELECT id, engine, name, created_at FROM workflows WHERE user_id = ? AND engine = ? ORDER BY created_at DESC",
            (user_id, engine),
        )
    else:
        cur.execute(
            "SELECT id, engine, name, created_at FROM workflows WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "workflow_id": str(r["id"]),
            "engine": str(r["engine"]),
            "name": str(r["name"]),
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]


def get_workflow(user_id: int, workflow_id: str) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, engine, name, raw_json, input_schema, created_at
        , runtime_config_json
        FROM workflows
        WHERE user_id = ? AND id = ?
        """,
        (user_id, workflow_id),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "workflow_id": str(row["id"]),
        "engine": str(row["engine"]),
        "name": str(row["name"]),
        "raw_json": json.loads(str(row["raw_json"])),
        "input_schema": json.loads(str(row["input_schema"])),
        "runtime_config": json.loads(str(row["runtime_config_json"])),
        "created_at": str(row["created_at"]),
    }


def update_workflow(
    user_id: int,
    workflow_id: str,
    name: str,
    raw_json: Dict[str, Any],
    input_schema: List[Dict[str, Any]],
    runtime_config: Dict[str, Any],
) -> bool:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE workflows
        SET name = ?, raw_json = ?, input_schema = ?, runtime_config_json = ?
        WHERE user_id = ? AND id = ?
        """,
        (
            name,
            json.dumps(raw_json),
            json.dumps(input_schema),
            json.dumps(runtime_config),
            user_id,
            workflow_id,
        ),
    )
    updated = cur.rowcount > 0
    conn.commit()
    conn.close()
    return updated


def delete_workflow(user_id: int, workflow_id: str) -> bool:
    conn = get_conn()
    cur = conn.cursor()
    # Keep history consistent by removing run instances for this workflow.
    cur.execute("DELETE FROM executions WHERE user_id = ? AND workflow_id = ?", (user_id, workflow_id))
    cur.execute("DELETE FROM workflows WHERE user_id = ? AND id = ?", (user_id, workflow_id))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def save_execution(
    workflow_id: str,
    user_id: int,
    engine: str,
    status: str,
    stage: str,
    message: str,
    output: Dict[str, Any],
    inputs: Dict[str, Any],
    runtime_config: Dict[str, Any],
) -> int:
    now = utcnow_iso()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO executions(
            workflow_id, user_id, engine, status, stage, message, output_json, inputs_json, runtime_config_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            workflow_id,
            user_id,
            engine,
            status,
            stage,
            message,
            json.dumps(output),
            json.dumps(inputs),
            json.dumps(runtime_config),
            now,
            now,
        ),
    )
    conn.commit()
    execution_id = int(cur.lastrowid)
    conn.close()
    return execution_id


def update_execution(
    user_id: int,
    execution_id: int,
    status: str,
    stage: str,
    message: str,
    output: Dict[str, Any],
) -> bool:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE executions
        SET status = ?, stage = ?, message = ?, output_json = ?, updated_at = ?
        WHERE user_id = ? AND id = ?
        """,
        (
            status,
            stage,
            message,
            json.dumps(output),
            utcnow_iso(),
            user_id,
            execution_id,
        ),
    )
    updated = cur.rowcount > 0
    conn.commit()
    conn.close()
    return updated


def list_executions(
    user_id: int,
    workflow_id: Optional[str] = None,
    engine: Optional[str] = None,
) -> List[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    if workflow_id and engine:
        cur.execute(
            """
            SELECT id, workflow_id, engine, status, stage, message, output_json, inputs_json, runtime_config_json, created_at, updated_at
            FROM executions
            WHERE user_id = ? AND workflow_id = ? AND engine = ?
            ORDER BY created_at DESC
            LIMIT 100
            """,
            (user_id, workflow_id, engine),
        )
    elif workflow_id:
        cur.execute(
            """
            SELECT id, workflow_id, engine, status, stage, message, output_json, inputs_json, runtime_config_json, created_at, updated_at
            FROM executions
            WHERE user_id = ? AND workflow_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            """,
            (user_id, workflow_id),
        )
    elif engine:
        cur.execute(
            """
            SELECT id, workflow_id, engine, status, stage, message, output_json, inputs_json, runtime_config_json, created_at, updated_at
            FROM executions
            WHERE user_id = ? AND engine = ?
            ORDER BY created_at DESC
            LIMIT 100
            """,
            (user_id, engine),
        )
    else:
        cur.execute(
            """
            SELECT id, workflow_id, engine, status, stage, message, output_json, inputs_json, runtime_config_json, created_at, updated_at
            FROM executions
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            """,
            (user_id,),
        )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "execution_id": int(r["id"]),
            "workflow_id": str(r["workflow_id"]),
            "engine": str(r["engine"]),
            "status": str(r["status"]),
            "stage": str(r["stage"] or ""),
            "message": str(r["message"]),
            "output": json.loads(str(r["output_json"])),
            "inputs": json.loads(str(r["inputs_json"])),
            "runtime_config": json.loads(str(r["runtime_config_json"])),
            "created_at": str(r["created_at"]),
            "updated_at": str(r["updated_at"] or r["created_at"]),
        }
        for r in rows
    ]


def get_execution(user_id: int, execution_id: int) -> Optional[Dict[str, Any]]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, workflow_id, engine, status, stage, message, output_json, inputs_json, runtime_config_json, created_at, updated_at
        FROM executions
        WHERE user_id = ? AND id = ?
        """,
        (user_id, execution_id),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "execution_id": int(row["id"]),
        "workflow_id": str(row["workflow_id"]),
        "engine": str(row["engine"]),
        "status": str(row["status"]),
        "stage": str(row["stage"] or ""),
        "message": str(row["message"]),
        "output": json.loads(str(row["output_json"])),
        "inputs": json.loads(str(row["inputs_json"])),
        "runtime_config": json.loads(str(row["runtime_config_json"])),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"] or row["created_at"]),
    }


def delete_execution(user_id: int, execution_id: int) -> bool:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM executions WHERE user_id = ? AND id = ?", (user_id, execution_id))
    deleted = cur.rowcount > 0
    conn.commit()
    conn.close()
    return deleted
