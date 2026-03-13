import { useEffect, useMemo, useState } from "react";
import langflowLogo from "./assets/langflow-logo.svg";
import n8nLogo from "./assets/n8n-logo.svg";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const EMPTY_REGISTER = { username: "", email: "", password: "" };
const EMPTY_LOGIN = { username: "", password: "" };

function App() {
  const [authToken, setAuthToken] = useState(localStorage.getItem("auth_token") || "");
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN);
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER);
  const [toast, setToast] = useState({ show: false, type: "info", message: "" });

  const [activePage, setActivePage] = useState("register-workflow");
  const [workflows, setWorkflows] = useState([]);
  const [history, setHistory] = useState([]);
  const [engineFilter, setEngineFilter] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("");
  const [historySortBy, setHistorySortBy] = useState("created_at");
  const [historySortDir, setHistorySortDir] = useState("desc");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  const [importEngine, setImportEngine] = useState("n8n");
  const [importName, setImportName] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importJsonText, setImportJsonText] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [registerRuntime, setRegisterRuntime] = useState({
    n8n_webhook_url: "",
    langflow_run_url: "",
    langflow_api_key: ""
  });
  const [editWorkflowId, setEditWorkflowId] = useState("");
  const [editEngine, setEditEngine] = useState("n8n");
  const [editName, setEditName] = useState("");
  const [editJsonText, setEditJsonText] = useState("");
  const [editRuntime, setEditRuntime] = useState({
    n8n_webhook_url: "",
    langflow_run_url: "",
    langflow_api_key: ""
  });

  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [runSchema, setRunSchema] = useState([]);
  const [runValues, setRunValues] = useState({});
  const [runErrors, setRunErrors] = useState({});
  const [runWorkflowRuntime, setRunWorkflowRuntime] = useState({});
  const [outputText, setOutputText] = useState("");
  const [outputFullText, setOutputFullText] = useState("");
  const [showFullOutput, setShowFullOutput] = useState(false);

  const [busy, setBusy] = useState({
    login: false,
    register: false,
    importFile: false,
    importJson: false,
    loadEditWorkflow: false,
    updateWorkflow: false,
    loadSchema: false,
    run: false,
    deleteWorkflow: false,
    deleteId: null
  });
  const [theme, setTheme] = useState(localStorage.getItem("ui_theme") || "light");

  const isAuthenticated = Boolean(authToken && user);

  useEffect(() => {
    if (!authToken) return;
    api("/api/auth/me")
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem("auth_token");
        setAuthToken("");
        setUser(null);
      });
  }, [authToken]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshAll(engineFilter);
  }, [isAuthenticated, engineFilter]);

  useEffect(() => {
    if (!toast.show) return undefined;
    const timer = window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    localStorage.setItem("ui_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const statusText = useMemo(() => {
    if (!isAuthenticated) return "Not logged in";
    return `${user.username} (${user.email})`;
  }, [isAuthenticated, user]);

  const hasOutputData = useMemo(() => {
    return Boolean((outputText || "").trim() || (outputFullText || "").trim());
  }, [outputText, outputFullText]);

  const renderedOutput = useMemo(() => {
    if (!hasOutputData) return "";
    return showFullOutput ? outputFullText || outputText : outputText || outputFullText;
  }, [hasOutputData, showFullOutput, outputFullText, outputText]);

  const pageMeta = useMemo(() => {
    if (activePage === "register-workflow") {
      return {
        title: "Workflow Registration",
        description:
          "Onboard n8n and Langflow workflows with engine-specific runtime configuration and governance-ready metadata."
      };
    }
    if (activePage === "run-workflow") {
      return {
        title: "Workflow Execution",
        description:
          "Select a registered workflow, review auto-detected inputs, and run with auditable processed and raw outputs."
      };
    }
    return {
      title: "Execution History",
      description:
        "Track every run, inspect results, rerun with edited inputs, and maintain clean operational history records."
    };
  }, [activePage]);

  const successRate = useMemo(() => {
    if (!history.length) return "0%";
    const successCount = history.filter((row) => row.status === "success").length;
    return `${Math.round((successCount / history.length) * 100)}%`;
  }, [history]);

  const workflowNameById = useMemo(() => {
    const map = {};
    workflows.forEach((workflow) => {
      map[workflow.workflow_id] = workflow.name || "Unnamed Workflow";
    });
    return map;
  }, [workflows]);

  const historyWithNames = useMemo(() => {
    return history.map((row) => ({
      ...row,
      workflow_name: workflowNameById[row.workflow_id] || "Unnamed Workflow"
    }));
  }, [history, workflowNameById]);

  const historyFilteredSorted = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    const filtered = historyWithNames.filter((row) => {
      if (historyStatusFilter && row.status !== historyStatusFilter) return false;
      if (!q) return true;
      const haystack = [
        row.workflow_name || "",
        row.workflow_id || "",
        row.engine || "",
        row.status || "",
        row.stage || "",
        row.message || "",
        row.created_at || ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    const parseTime = (value) => {
      const ts = new Date(value || "").getTime();
      return Number.isNaN(ts) ? 0 : ts;
    };

    const sorted = [...filtered].sort((a, b) => {
      let left;
      let right;
      if (historySortBy === "created_at") {
        left = parseTime(a.created_at);
        right = parseTime(b.created_at);
      } else if (historySortBy === "workflow_name") {
        left = (a.workflow_name || "").toLowerCase();
        right = (b.workflow_name || "").toLowerCase();
      } else if (historySortBy === "workflow_id") {
        left = (a.workflow_id || "").toLowerCase();
        right = (b.workflow_id || "").toLowerCase();
      } else if (historySortBy === "engine") {
        left = (a.engine || "").toLowerCase();
        right = (b.engine || "").toLowerCase();
      } else if (historySortBy === "stage") {
        left = (a.stage || "").toLowerCase();
        right = (b.stage || "").toLowerCase();
      } else {
        left = (a.status || "").toLowerCase();
        right = (b.status || "").toLowerCase();
      }

      if (left < right) return historySortDir === "asc" ? -1 : 1;
      if (left > right) return historySortDir === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [historyWithNames, historyQuery, historyStatusFilter, historySortBy, historySortDir]);

  const historyTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(historyFilteredSorted.length / historyPageSize));
  }, [historyFilteredSorted.length, historyPageSize]);

  const historyPageRows = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return historyFilteredSorted.slice(start, start + historyPageSize);
  }, [historyFilteredSorted, historyPage, historyPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyQuery, historyStatusFilter, historySortBy, historySortDir, historyPageSize, engineFilter]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  useEffect(() => {
    if (!isAuthenticated || activePage !== "history-dashboard") return undefined;
    if (!history.some((row) => row.status === "running")) return undefined;

    const timer = window.setInterval(() => {
      void loadHistory(engineFilter);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, activePage, history, engineFilter]);

  async function api(path, options = {}, { skipAuth = false, isForm = false } = {}) {
    const headers = { ...(options.headers || {}) };
    if (!isForm) headers["Content-Type"] = headers["Content-Type"] || "application/json";
    if (!skipAuth && authToken) headers.Authorization = `Bearer ${authToken}`;

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { detail: text };
      }
    }
    if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
    return data;
  }

  function notify(message, type = "info") {
    setToast({ show: true, type, message });
  }

  function extractFinalValue(output) {
    if (!output || typeof output !== "object") return "";
    const direct = output.final_result;
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    const nested =
      output?.response?.outputs?.[0]?.outputs?.[0]?.outputs?.message?.message ??
      output?.response?.outputs?.[0]?.outputs?.[0]?.results?.message?.text;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    return "";
  }

  function formatRunResult(result) {
    const finalValue = extractFinalValue(result?.output || {});
    const sentInputs = result?.output?.sent_inputs || {};
    return [
      `Status: ${result?.status || "unknown"}`,
      `Message: ${result?.message || ""}`,
      `Final Result: ${finalValue || "[Empty result from flow]"}`,
      `Sent Inputs: ${JSON.stringify(sentInputs, null, 2)}`
    ].join("\n\n");
  }

  async function copyOutput() {
    if (!hasOutputData) {
      notify("Nothing to copy yet.", "info");
      return;
    }
    try {
      const toCopy = showFullOutput ? outputFullText || outputText : outputText;
      await navigator.clipboard.writeText(toCopy || "");
      notify("Output copied to clipboard.", "success");
    } catch {
      notify("Unable to copy output.", "error");
    }
  }

  function setOutputFromRunResult(result) {
    setOutputText(formatRunResult(result));
    setOutputFullText(JSON.stringify(result, null, 2));
    setShowFullOutput(false);
  }

  function setOutputFromHistoryRow(row) {
    setOutputText(
      [
        `Status: ${row.status}`,
        `Stage: ${row.stage || "n/a"}`,
        `Message: ${row.message}`,
        `Final Result: ${extractFinalValue(row.output || {}) || "[Empty result from flow]"}`,
        `Sent Inputs: ${JSON.stringify(row.inputs || {}, null, 2)}`
      ].join("\n\n")
    );
    setOutputFullText(
      JSON.stringify(
        {
          execution_id: row.execution_id,
          workflow_id: row.workflow_id,
          engine: row.engine,
          status: row.status,
          stage: row.stage || "",
          message: row.message,
          created_at: row.created_at,
          updated_at: row.updated_at,
          inputs: row.inputs || {},
          runtime_config: row.runtime_config || {},
          output: row.output || {}
        },
        null,
        2
      )
    );
    setShowFullOutput(false);
  }

  async function onLogin() {
    if (!loginForm.username || !loginForm.password) {
      return notify("Username and password required.", "error");
    }
    setBusy((b) => ({ ...b, login: true }));
    try {
      const data = await api(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify(loginForm) },
        { skipAuth: true }
      );
      localStorage.setItem("auth_token", data.token);
      setAuthToken(data.token);
      setUser(data.user);
      setLoginForm(EMPTY_LOGIN);
      notify("Login successful.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, login: false }));
    }
  }

  async function onRegister() {
    if (!registerForm.username || !registerForm.email || !registerForm.password) {
      return notify("Username, email, and password required.", "error");
    }
    setBusy((b) => ({ ...b, register: true }));
    try {
      const data = await api(
        "/api/auth/register",
        { method: "POST", body: JSON.stringify(registerForm) },
        { skipAuth: true }
      );
      localStorage.setItem("auth_token", data.token);
      setAuthToken(data.token);
      setUser(data.user);
      setRegisterForm(EMPTY_REGISTER);
      notify("Account created.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, register: false }));
    }
  }

  async function onLogout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout errors.
    }
    localStorage.removeItem("auth_token");
    setAuthToken("");
    setUser(null);
    setWorkflows([]);
    setHistory([]);
    setRunSchema([]);
    setRunValues({});
    setRunErrors({});
    setRunWorkflowRuntime({});
    setEditWorkflowId("");
    setEditEngine("n8n");
    setEditName("");
    setEditJsonText("");
    setEditRuntime({
      n8n_webhook_url: "",
      langflow_run_url: "",
      langflow_api_key: ""
    });
    setOutputText("");
    setOutputFullText("");
    setShowFullOutput(false);
    setSelectedWorkflowId("");
    notify("Logged out.", "success");
  }

  async function refreshAll(engine = "") {
    await Promise.all([loadWorkflows(engine), loadHistory(engine)]);
  }

  async function loadWorkflows(engine = "") {
    const query = engine ? `?engine=${encodeURIComponent(engine)}` : "";
    const rows = await api(`/api/workflows${query}`);
    setWorkflows(Array.isArray(rows) ? rows : []);
  }

  async function loadHistory(engine = "") {
    const query = engine ? `?engine=${encodeURIComponent(engine)}` : "";
    const rows = await api(`/api/executions${query}`);
    setHistory(Array.isArray(rows) ? rows : []);
  }

  async function importFromFile() {
    if (!importFile) return notify("Choose a JSON file first.", "error");
    if (importEngine === "n8n" && !registerRuntime.n8n_webhook_url.trim()) {
      return notify("n8n webhook URL is required for n8n workflow registration.", "error");
    }
    if (importEngine === "langflow") {
      if (!registerRuntime.langflow_run_url.trim()) {
        return notify("Langflow run URL is required for langflow workflow registration.", "error");
      }
      if (!registerRuntime.langflow_api_key.trim()) {
        return notify("Langflow API key is required for langflow workflow registration.", "error");
      }
    }
    setBusy((b) => ({ ...b, importFile: true }));
    try {
      const form = new FormData();
      form.append("file", importFile);
      const runtimeConfig = buildRegistrationRuntimeConfig();
      form.append("n8n_webhook_url", runtimeConfig.n8n_webhook_url || "");
      form.append("langflow_run_url", runtimeConfig.langflow_run_url || "");
      form.append("langflow_api_key", runtimeConfig.langflow_api_key || "");
      const result = await api("/api/workflows/import", { method: "POST", body: form }, { isForm: true });
      notify(`Workflow registered: ${result.name}`, "success");
      resetRegistrationFields();
      await refreshAll(engineFilter);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, importFile: false }));
    }
  }

  async function importFromJson() {
    if (!importJsonText.trim()) return notify("Paste JSON first.", "error");
    let parsed;
    try {
      parsed = JSON.parse(importJsonText);
    } catch {
      return notify("Invalid JSON content.", "error");
    }
    if (importEngine === "n8n" && !registerRuntime.n8n_webhook_url.trim()) {
      return notify("n8n webhook URL is required for n8n workflow registration.", "error");
    }
    if (importEngine === "langflow") {
      if (!registerRuntime.langflow_run_url.trim()) {
        return notify("Langflow run URL is required for langflow workflow registration.", "error");
      }
      if (!registerRuntime.langflow_api_key.trim()) {
        return notify("Langflow API key is required for langflow workflow registration.", "error");
      }
    }
    setBusy((b) => ({ ...b, importJson: true }));
    try {
      const runtimeConfig = buildRegistrationRuntimeConfig();
      const result = await api("/api/workflows/import-json", {
        method: "POST",
        body: JSON.stringify({
          raw_json: parsed,
          engine: importEngine || null,
          name: importName || null,
          runtime_config: runtimeConfig
        })
      });
      notify(`Workflow registered: ${result.name}`, "success");
      resetRegistrationFields();
      await refreshAll(engineFilter);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, importJson: false }));
    }
  }

  function resetRegistrationFields() {
    setImportEngine("n8n");
    setImportName("");
    setImportFile(null);
    setImportJsonText("");
    setRegisterRuntime({
      n8n_webhook_url: "",
      langflow_run_url: "",
      langflow_api_key: ""
    });
    setFileInputKey((k) => k + 1);
  }

  function buildRegistrationRuntimeConfig() {
    if (importEngine === "n8n") {
      return {
        n8n_webhook_url: registerRuntime.n8n_webhook_url.trim()
      };
    }
    return {
      langflow_run_url: registerRuntime.langflow_run_url.trim(),
      langflow_api_key: registerRuntime.langflow_api_key.trim()
    };
  }

  function buildEditRuntimeConfig() {
    if (editEngine === "n8n") {
      return {
        n8n_webhook_url: editRuntime.n8n_webhook_url.trim()
      };
    }
    return {
      langflow_run_url: editRuntime.langflow_run_url.trim(),
      langflow_api_key: editRuntime.langflow_api_key.trim()
    };
  }

  async function loadWorkflowForEdit() {
    if (!editWorkflowId) {
      notify("Select a workflow to edit first.", "error");
      return;
    }
    setBusy((b) => ({ ...b, loadEditWorkflow: true }));
    try {
      const workflow = await api(`/api/workflows/${encodeURIComponent(editWorkflowId)}`);
      setEditEngine(workflow.engine);
      setEditName(workflow.name || "");
      setEditJsonText(JSON.stringify(workflow.raw_json || {}, null, 2));
      setEditRuntime({
        n8n_webhook_url: workflow.runtime_config?.n8n_webhook_url || "",
        langflow_run_url: workflow.runtime_config?.langflow_run_url || "",
        langflow_api_key: workflow.runtime_config?.langflow_api_key || ""
      });
      notify("Workflow loaded for editing.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, loadEditWorkflow: false }));
    }
  }

  async function updateEditedWorkflow() {
    if (!editWorkflowId) {
      notify("Select a workflow to edit first.", "error");
      return;
    }
    if (!editJsonText.trim()) {
      notify("Workflow JSON cannot be empty.", "error");
      return;
    }

    let parsedJson;
    try {
      parsedJson = JSON.parse(editJsonText);
    } catch {
      notify("Invalid JSON in editor.", "error");
      return;
    }

    const runtimeConfig = buildEditRuntimeConfig();
    if (editEngine === "n8n" && !runtimeConfig.n8n_webhook_url) {
      notify("n8n webhook URL is required.", "error");
      return;
    }
    if (editEngine === "langflow") {
      if (!runtimeConfig.langflow_run_url) {
        notify("Langflow run URL is required.", "error");
        return;
      }
      if (!runtimeConfig.langflow_api_key) {
        notify("Langflow API key is required.", "error");
        return;
      }
    }

    setBusy((b) => ({ ...b, updateWorkflow: true }));
    try {
      const updated = await api(`/api/workflows/${encodeURIComponent(editWorkflowId)}`, {
        method: "PUT",
        body: JSON.stringify({
          raw_json: parsedJson,
          name: editName.trim() || null,
          runtime_config: runtimeConfig
        })
      });
      setEditEngine(updated.engine);
      setEditName(updated.name || "");
      setEditJsonText(JSON.stringify(updated.raw_json || parsedJson, null, 2));
      setEditRuntime({
        n8n_webhook_url: updated.runtime_config?.n8n_webhook_url || "",
        langflow_run_url: updated.runtime_config?.langflow_run_url || "",
        langflow_api_key: updated.runtime_config?.langflow_api_key || ""
      });
      notify("Workflow updated successfully.", "success");
      await refreshAll(engineFilter);
      if (selectedWorkflowId === editWorkflowId) {
        await loadRunSchema(selectedWorkflowId);
      }
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, updateWorkflow: false }));
    }
  }

  function buildFieldValuesFromSchema(schema, sourceInputs = {}) {
    const defaults = {};
    schema.forEach((field) => {
      const hasSourceValue = Object.prototype.hasOwnProperty.call(sourceInputs, field.key);
      const sourceValue = hasSourceValue ? sourceInputs[field.key] : undefined;
      const valueToUse =
        hasSourceValue
          ? sourceValue
          : field.default !== null && field.default !== undefined
            ? field.default
            : field.field_type === "json"
              ? {}
              : field.field_type === "boolean"
                ? true
                : "";

      if (field.field_type === "json") {
        defaults[field.key] = JSON.stringify(valueToUse ?? {}, null, 2);
      } else if (field.field_type === "boolean") {
        defaults[field.key] = valueToUse ? "true" : "false";
      } else {
        defaults[field.key] = valueToUse === null || valueToUse === undefined ? "" : String(valueToUse);
      }
    });
    return defaults;
  }

  async function loadRunSchema(workflowId, sourceInputs = null) {
    if (!workflowId) return;
    setBusy((b) => ({ ...b, loadSchema: true }));
    try {
      const workflow = await api(`/api/workflows/${encodeURIComponent(workflowId)}`);
      const schema = Array.isArray(workflow.input_schema) ? workflow.input_schema : [];
      setRunSchema(schema);
      setRunValues(buildFieldValuesFromSchema(schema, sourceInputs || {}));
      setRunErrors({});
      setRunWorkflowRuntime(workflow.runtime_config || {});
      notify(sourceInputs ? "Previous inputs loaded. Update and run again." : "Workflow inputs loaded.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, loadSchema: false }));
    }
  }

  function setRunValue(key, value) {
    setRunValues((v) => ({ ...v, [key]: value }));
  }

  function buildRunInputs() {
    const nextErrors = {};
    const inputs = {};
    for (const field of runSchema) {
      const raw = (runValues[field.key] ?? "").toString();
      if (field.required && !raw.trim()) {
        nextErrors[field.key] = "Required";
        continue;
      }
      if (field.field_type === "number") {
        if (!raw.trim()) inputs[field.key] = null;
        else {
          const n = Number(raw);
          if (Number.isNaN(n)) nextErrors[field.key] = "Invalid number";
          else inputs[field.key] = n;
        }
      } else if (field.field_type === "boolean") {
        inputs[field.key] = raw === "true";
      } else if (field.field_type === "json") {
        if (!raw.trim()) inputs[field.key] = {};
        else {
          try {
            inputs[field.key] = JSON.parse(raw);
          } catch {
            nextErrors[field.key] = "Invalid JSON";
          }
        }
      } else {
        inputs[field.key] = raw;
      }
    }
    setRunErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      throw new Error("Please fix field errors first.");
    }
    return inputs;
  }

  async function runWorkflow() {
    if (!selectedWorkflowId) return notify("Select a workflow first.", "error");
    let inputs;
    try {
      inputs = buildRunInputs();
    } catch (err) {
      return notify(err.message, "error");
    }
    setBusy((b) => ({ ...b, run: true }));
    setOutputText("Running workflow...");
    setOutputFullText("");
    setShowFullOutput(false);
    try {
      const result = await api(`/api/workflows/${encodeURIComponent(selectedWorkflowId)}/run`, {
        method: "POST",
        body: JSON.stringify({ inputs, runtime_config: {} })
      });
      if (result.status === "running" && result.execution_id) {
        setOutputText(
          [
            `Status: running`,
            `Stage: ${result.stage || "queued"}`,
            `Message: ${result.message || "Execution started."}`,
            `Execution ID: ${result.execution_id}`,
            "",
            "Live polling started..."
          ].join("\n")
        );
        notify("Execution started. Tracking live status.", "success");
        await loadHistory(engineFilter);
        await pollExecutionUntilComplete(result.execution_id);
      } else {
        setOutputFromRunResult(result);
        notify(`Run complete: ${result.status}`, "success");
        await loadHistory(engineFilter);
      }
    } catch (err) {
      setOutputText(`Run failed: ${err.message}`);
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, run: false }));
    }
  }

  async function pollExecutionUntilComplete(executionId) {
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const row = await api(`/api/executions/${executionId}`);
      if (row.status === "running") {
        setOutputText(
          [
            `Status: running`,
            `Stage: ${row.stage || "processing"}`,
            `Message: ${row.message || "In progress"}`,
            `Execution ID: ${executionId}`,
            "",
            "Waiting for completion..."
          ].join("\n")
        );
        await loadHistory(engineFilter);
        continue;
      }
      setOutputFromHistoryRow(row);
      notify(`Run complete: ${row.status}`, row.status === "success" ? "success" : "error");
      await loadHistory(engineFilter);
      return;
    }
    notify("Execution is still running. Check history for live status.", "info");
  }

  async function prepareRerun(row) {
    setActivePage("run-workflow");
    setSelectedWorkflowId(row.workflow_id);
    await loadRunSchema(row.workflow_id, row.inputs || {});
  }

  async function deleteExecution(executionId) {
    setBusy((b) => ({ ...b, deleteId: executionId }));
    try {
      await api(`/api/executions/${executionId}`, { method: "DELETE" });
      notify("Run instance deleted.", "success");
      await loadHistory(engineFilter);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, deleteId: null }));
    }
  }

  async function deleteSelectedWorkflow() {
    if (!selectedWorkflowId) return notify("Select a workflow first.", "error");
    setBusy((b) => ({ ...b, deleteWorkflow: true }));
    try {
      await api(`/api/workflows/${encodeURIComponent(selectedWorkflowId)}`, { method: "DELETE" });
      notify("Workflow deleted successfully.", "success");
      setSelectedWorkflowId("");
      setRunSchema([]);
      setRunValues({});
      setRunErrors({});
      setRunWorkflowRuntime({});
      if (editWorkflowId === selectedWorkflowId) {
        setEditWorkflowId("");
        setEditEngine("n8n");
        setEditName("");
        setEditJsonText("");
        setEditRuntime({
          n8n_webhook_url: "",
          langflow_run_url: "",
          langflow_api_key: ""
        });
      }
      setOutputText("");
      setOutputFullText("");
      setShowFullOutput(false);
      await refreshAll(engineFilter);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy((b) => ({ ...b, deleteWorkflow: false }));
    }
  }

  function onHistoryHeaderSort(column) {
    if (historySortBy === column) {
      setHistorySortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setHistorySortBy(column);
    setHistorySortDir(column === "created_at" ? "desc" : "asc");
  }

  function getSortIndicator(column) {
    if (historySortBy !== column) return " ";
    return historySortDir === "asc" ? "↑" : "↓";
  }

  function getEngineLogo(engine) {
    return engine === "langflow" ? langflowLogo : n8nLogo;
  }

  return (
    <div className={`app ${theme === "dark" ? "theme-dark" : "theme-light"}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">WS</div>
          <div>
            <div className="brand-title">Workflow Runtime Studio</div>
            <div className="brand-sub">Enterprise workflow operations</div>
          </div>
        </div>
        <div className="topbar-right">
          <button
            className="btn-secondary theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <div className="status-pill">{statusText}</div>
        </div>
      </header>

      <section className="hero">
        <h1>Enterprise workflow operations platform for n8n and Langflow</h1>
        <p>
          Register once, run anytime with auto-detected inputs, and track every execution from a
          central dashboard with rerun and governance controls. Built for faster delivery, fewer
          manual errors, and better operational visibility.
        </p>
        <div className="hero-chips">
          <span className="hero-chip">Secure Auth and Session Control</span>
          <span className="hero-chip">Unified n8n and Langflow Runtime</span>
          <span className="hero-chip">Operational History and Reruns</span>
        </div>
        <div className="hero-platforms">
          <div className="hero-platform">
            <img src={n8nLogo} alt="n8n" className="brand-mark" />
            <span>n8n Workflows</span>
          </div>
          <div className="hero-platform">
            <img src={langflowLogo} alt="Langflow" className="brand-mark" />
            <span>Langflow Flows</span>
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="auth-shell">
          <div className="panel auth-intro">
            <h2>Control Workflow Operations from One Workspace</h2>
            <p className="sub">
              Register, execute, audit, and rerun n8n or Langflow workflows with role-based access,
              structured outputs, and enterprise-grade operational visibility.
            </p>
            <div className="auth-intro-points">
              <div className="auth-point">Unified workflow catalog across engines</div>
              <div className="auth-point">Execution-ready dynamic input forms</div>
              <div className="auth-point">History timeline with rerun and deletion controls</div>
            </div>
            <div className="supported-engines">
              <div className="supported-engine">
                <img src={n8nLogo} alt="n8n" className="brand-mark" />
                <span>n8n</span>
              </div>
              <div className="supported-engine">
                <img src={langflowLogo} alt="Langflow" className="brand-mark" />
                <span>Langflow</span>
              </div>
            </div>
          </div>
          <div className="auth-grid">
            <div className="panel">
              <h2>Login</h2>
              <p className="sub">Use username and password.</p>
              <label>Username</label>
              <input
                value={loginForm.username}
                onChange={(e) => setLoginForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="username"
              />
              <label>Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="password"
              />
              <div className="actions">
                <button className="btn-primary" onClick={onLogin} disabled={busy.login}>
                  {busy.login ? "Signing in..." : "Login"}
                </button>
              </div>
            </div>
            <div className="panel">
              <h2>Create account</h2>
              <p className="sub">Register with username, email, and password.</p>
              <label>Username</label>
              <input
                value={registerForm.username}
                onChange={(e) => setRegisterForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="username"
              />
              <label>Email</label>
              <input
                type="email"
                value={registerForm.email}
                onChange={(e) => setRegisterForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="you@company.com"
              />
              <label>Password</label>
              <input
                type="password"
                value={registerForm.password}
                onChange={(e) => setRegisterForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="minimum 6 chars"
              />
              <div className="actions">
                <button className="btn-primary" onClick={onRegister} disabled={busy.register}>
                  {busy.register ? "Creating..." : "Create Account"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="workspace-shell">
          <aside className="panel workspace-sidebar">
            <div className="workspace-user">
              <div className="workspace-user-title">Workspace</div>
              <div className="workspace-user-sub">Signed in as {user.username}</div>
              <div className="workspace-engines">
                <div className="workspace-engine">
                  <img src={n8nLogo} alt="n8n" className="engine-logo sm" />
                  <span>n8n</span>
                </div>
                <div className="workspace-engine">
                  <img src={langflowLogo} alt="Langflow" className="engine-logo sm" />
                  <span>Langflow</span>
                </div>
              </div>
            </div>

            <nav className="page-nav vertical">
              <button
                className={`nav-btn ${activePage === "register-workflow" ? "active" : ""}`}
                onClick={() => setActivePage("register-workflow")}
              >
                <span className="nav-ico">RG</span>
                <span>Register Workflow</span>
              </button>
              <button
                className={`nav-btn ${activePage === "run-workflow" ? "active" : ""}`}
                onClick={() => setActivePage("run-workflow")}
              >
                <span className="nav-ico">RN</span>
                <span>Run Workflow</span>
              </button>
              <button
                className={`nav-btn ${activePage === "history-dashboard" ? "active" : ""}`}
                onClick={() => setActivePage("history-dashboard")}
              >
                <span className="nav-ico">HS</span>
                <span>History Dashboard</span>
              </button>
            </nav>

            <div className="workspace-kpis">
              <div className="kpi-card">
                <div className="kpi-label">Registered Workflows</div>
                <div className="kpi-value">{workflows.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Execution Runs</div>
                <div className="kpi-value">{history.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Success Rate</div>
                <div className="kpi-value">{successRate}</div>
              </div>
            </div>

            <button className="btn-danger sidebar-logout" onClick={onLogout}>
              Logout
            </button>
          </aside>

          <main className="workspace-main">
            <section className="panel page-header">
              <h2>{pageMeta.title}</h2>
              <p className="sub">{pageMeta.description}</p>
            </section>

          {activePage === "register-workflow" && (
            <section className="panel page-panel">
              <div className="card">
                <h3 className="card-title">Source and Metadata</h3>
                <div className="grid-3">
                  <div>
                    <label>Engine</label>
                    <select value={importEngine} onChange={(e) => setImportEngine(e.target.value)}>
                      <option value="n8n">n8n</option>
                      <option value="langflow">langflow</option>
                    </select>
                    <div className="engine-preview">
                      <img src={getEngineLogo(importEngine)} alt={importEngine} className="engine-logo" />
                      <span>{importEngine === "n8n" ? "n8n" : "Langflow"} selected</span>
                    </div>
                  </div>
                  <div>
                    <label>Workflow Name (optional)</label>
                    <input value={importName} onChange={(e) => setImportName(e.target.value)} />
                  </div>
                  <div>
                    <label>Upload JSON</label>
                    <input
                      key={fileInputKey}
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    />
                  </div>
                </div>
                <div className="actions">
                  <button className="btn-primary" onClick={importFromFile} disabled={busy.importFile}>
                    {busy.importFile ? "Registering..." : "Register from File"}
                  </button>
                </div>
                <div className="meta">You can upload a file or use raw JSON input below.</div>
                {importEngine === "n8n" ? (
                  <>
                    <label>n8n Webhook URL</label>
                    <input
                      value={registerRuntime.n8n_webhook_url}
                      onChange={(e) =>
                        setRegisterRuntime((r) => ({ ...r, n8n_webhook_url: e.target.value }))
                      }
                      placeholder="Required for n8n workflows"
                    />
                  </>
                ) : (
                  <>
                    <label>Langflow Run URL</label>
                    <input
                      value={registerRuntime.langflow_run_url}
                      onChange={(e) =>
                        setRegisterRuntime((r) => ({ ...r, langflow_run_url: e.target.value }))
                      }
                      placeholder="Required for Langflow workflows"
                    />
                    <label>Langflow API Key</label>
                    <input
                      type="password"
                      value={registerRuntime.langflow_api_key}
                      onChange={(e) =>
                        setRegisterRuntime((r) => ({ ...r, langflow_api_key: e.target.value }))
                      }
                      placeholder="Required for Langflow workflows"
                    />
                  </>
                )}
                <label>Or paste workflow JSON</label>
                <textarea value={importJsonText} onChange={(e) => setImportJsonText(e.target.value)} />
                <div className="actions">
                  <button className="btn-secondary" onClick={importFromJson} disabled={busy.importJson}>
                    {busy.importJson ? "Registering..." : "Register from JSON"}
                  </button>
                </div>
              </div>

              <div className="card">
                <h3 className="card-title">Edit Existing Workflow</h3>
                <div className="grid-2">
                  <div>
                    <label>Select Workflow</label>
                    <select value={editWorkflowId} onChange={(e) => setEditWorkflowId(e.target.value)}>
                      <option value="">Select workflow</option>
                      {workflows.map((w) => (
                        <option key={w.workflow_id} value={w.workflow_id}>
                          {w.name} ({w.engine})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="actions align-end">
                    <button
                      className="btn-secondary"
                      onClick={loadWorkflowForEdit}
                      disabled={!editWorkflowId || busy.loadEditWorkflow}
                    >
                      {busy.loadEditWorkflow ? "Loading..." : "Load for Edit"}
                    </button>
                  </div>
                </div>

                {editWorkflowId ? (
                  <>
                    <div className="engine-preview">
                      <img src={getEngineLogo(editEngine)} alt={editEngine} className="engine-logo" />
                      <span>{editEngine} workflow</span>
                    </div>
                    <label>Workflow Name</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />

                    {editEngine === "n8n" ? (
                      <>
                        <label>n8n Webhook URL</label>
                        <input
                          value={editRuntime.n8n_webhook_url}
                          onChange={(e) =>
                            setEditRuntime((r) => ({ ...r, n8n_webhook_url: e.target.value }))
                          }
                        />
                      </>
                    ) : (
                      <>
                        <label>Langflow Run URL</label>
                        <input
                          value={editRuntime.langflow_run_url}
                          onChange={(e) =>
                            setEditRuntime((r) => ({ ...r, langflow_run_url: e.target.value }))
                          }
                        />
                        <label>Langflow API Key</label>
                        <input
                          type="password"
                          value={editRuntime.langflow_api_key}
                          onChange={(e) =>
                            setEditRuntime((r) => ({ ...r, langflow_api_key: e.target.value }))
                          }
                        />
                      </>
                    )}

                    <label>Edit Workflow JSON</label>
                    <textarea value={editJsonText} onChange={(e) => setEditJsonText(e.target.value)} />
                    <div className="actions">
                      <button
                        className="btn-primary"
                        onClick={updateEditedWorkflow}
                        disabled={busy.updateWorkflow}
                      >
                        {busy.updateWorkflow ? "Saving..." : "Save Workflow Changes"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state output-empty">
                    <div className="empty-title">No workflow selected for edit</div>
                    <div className="meta">Select a workflow and click "Load for Edit" to modify JSON or config.</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {activePage === "run-workflow" && (
            <section className="run-layout">
              <div className="panel page-panel">
              <div className="card">
                <h3 className="card-title">Workflow Selection</h3>
                <div className="grid-2">
                  <div>
                    <label>Registered Workflow</label>
                    <select
                      value={selectedWorkflowId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedWorkflowId(id);
                        setRunSchema([]);
                        setRunValues({});
                        setRunErrors({});
                        setRunWorkflowRuntime({});
                        if (id) {
                          void loadRunSchema(id);
                        }
                      }}
                    >
                      <option value="">Select workflow</option>
                      {workflows.map((w) => (
                        <option key={w.workflow_id} value={w.workflow_id}>
                          {w.name} ({w.engine})
                        </option>
                      ))}
                    </select>
                    {selectedWorkflowId && (() => {
                      const selected = workflows.find((w) => w.workflow_id === selectedWorkflowId);
                      if (!selected) return null;
                      return (
                        <div className="engine-preview">
                          <img
                            src={getEngineLogo(selected.engine)}
                            alt={selected.engine}
                            className="engine-logo"
                          />
                          <span>{selected.engine} workflow selected</span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="actions align-end">
                    <div className="meta">
                      {busy.loadSchema
                        ? "Loading inputs..."
                        : selectedWorkflowId
                          ? "Inputs auto-loaded on selection"
                          : "Select a workflow to load inputs"}
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="btn-danger"
                    onClick={deleteSelectedWorkflow}
                    disabled={!selectedWorkflowId || busy.deleteWorkflow}
                  >
                    {busy.deleteWorkflow ? "Deleting..." : "Delete Selected Workflow"}
                  </button>
                </div>
              </div>

              <div className="card">
                <h3 className="card-title">Detected Input Parameters</h3>
                <div className="fields">
                  {runSchema.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-title">No input fields yet</div>
                      <div className="meta">Select a workflow to auto-load and validate runtime inputs.</div>
                    </div>
                  ) : (
                    runSchema.map((field) => (
                      <div className="field" key={field.key}>
                        <label>
                          {field.label || field.key} ({field.field_type || "string"}) {field.required ? "*" : ""}
                        </label>
                        {field.field_type === "boolean" ? (
                          <select
                            value={runValues[field.key] ?? "true"}
                            onChange={(e) => setRunValue(field.key, e.target.value)}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : field.field_type === "json" ? (
                          <textarea
                            value={runValues[field.key] ?? "{}"}
                            onChange={(e) => setRunValue(field.key, e.target.value)}
                          />
                        ) : (
                          <input
                            type={field.field_type === "number" ? "number" : "text"}
                            value={runValues[field.key] ?? ""}
                            onChange={(e) => setRunValue(field.key, e.target.value)}
                          />
                        )}
                        <div className="err">{runErrors[field.key] || ""}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

                <div className="panel inner-output-panel">
                  <h2>Execution Output</h2>
                  {hasOutputData ? (
                    <>
                      <div className="actions">
                        <button className="btn-secondary" onClick={copyOutput}>
                          Copy Output
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => setShowFullOutput((v) => !v)}
                          disabled={!outputFullText}
                        >
                          {showFullOutput ? "Show Processed Output" : "Show Full Response"}
                        </button>
                      </div>
                      <pre className="output">{renderedOutput}</pre>
                    </>
                  ) : (
                    <div className="empty-state output-empty">
                      <div className="empty-title">No output to display</div>
                      <div className="meta">Run a workflow to see processed output and full response here.</div>
                    </div>
                  )}
                </div>
              </div>

              <aside className="panel run-help">
                <h2>Execution Guidance</h2>
                <p className="sub">
                  Inputs are auto-loaded after workflow selection. Runtime configuration is inherited
                  from registration for predictable and repeatable operations.
                </p>
                <div className="card">
                  <div className="meta">Runtime configuration for selected workflow</div>
                  <pre className="output mini">{JSON.stringify(runWorkflowRuntime, null, 2)}</pre>
                  <div className="actions">
                    <button className="btn-primary" onClick={runWorkflow} disabled={busy.run || !selectedWorkflowId}>
                      {busy.run ? "Running..." : "Run Workflow"}
                    </button>
                  </div>
                </div>
              </aside>
            </section>
          )}

          {activePage === "history-dashboard" && (
            <section className="panel page-panel">
              <div className="history-controls">
                <div className="grid-2">
                  <div>
                    <label>Filter workflows by engine</label>
                    <select value={engineFilter} onChange={(e) => setEngineFilter(e.target.value)}>
                      <option value="">All</option>
                      <option value="n8n">n8n</option>
                      <option value="langflow">langflow</option>
                    </select>
                  </div>
                  <div className="actions align-end">
                    <button className="btn-secondary" onClick={() => refreshAll(engineFilter)}>
                      Refresh Dashboard
                    </button>
                  </div>
                </div>
                <div className="grid-4 compact-grid">
                  <div>
                    <label>Search</label>
                    <input
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder="name, id, message, timestamp"
                    />
                  </div>
                  <div>
                    <label>Status</label>
                    <select
                      value={historyStatusFilter}
                      onChange={(e) => setHistoryStatusFilter(e.target.value)}
                    >
                      <option value="">All</option>
                      <option value="running">running</option>
                      <option value="success">success</option>
                      <option value="failed">failed</option>
                      <option value="dry_run">dry_run</option>
                    </select>
                  </div>
                  <div>
                    <label>Sort By</label>
                    <select value={historySortBy} onChange={(e) => setHistorySortBy(e.target.value)}>
                      <option value="created_at">Run At</option>
                      <option value="workflow_name">Workflow Name</option>
                      <option value="workflow_id">Workflow ID</option>
                      <option value="engine">Engine</option>
                      <option value="stage">Stage</option>
                      <option value="status">Status</option>
                    </select>
                  </div>
                  <div>
                    <label>Sort Direction</label>
                    <select value={historySortDir} onChange={(e) => setHistorySortDir(e.target.value)}>
                      <option value="desc">Newest / Z-A</option>
                      <option value="asc">Oldest / A-Z</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="history-table-wrap compact">
                <table className="history-table compact">
                  <thead>
                    <tr>
                      <th>
                        <button className="th-sort" onClick={() => onHistoryHeaderSort("status")}>
                          Status <span className="sort-indicator">{getSortIndicator("status")}</span>
                        </button>
                      </th>
                      <th>
                        <button className="th-sort" onClick={() => onHistoryHeaderSort("workflow_name")}>
                          Workflow Name <span className="sort-indicator">{getSortIndicator("workflow_name")}</span>
                        </button>
                      </th>
                      <th>
                        <button className="th-sort" onClick={() => onHistoryHeaderSort("workflow_id")}>
                          Workflow ID <span className="sort-indicator">{getSortIndicator("workflow_id")}</span>
                        </button>
                      </th>
                      <th>
                        <button className="th-sort" onClick={() => onHistoryHeaderSort("engine")}>
                          Engine <span className="sort-indicator">{getSortIndicator("engine")}</span>
                        </button>
                      </th>
                      <th>
                        <button className="th-sort" onClick={() => onHistoryHeaderSort("stage")}>
                          Stage <span className="sort-indicator">{getSortIndicator("stage")}</span>
                        </button>
                      </th>
                      <th>
                        <button className="th-sort" onClick={() => onHistoryHeaderSort("created_at")}>
                          Run At <span className="sort-indicator">{getSortIndicator("created_at")}</span>
                        </button>
                      </th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyPageRows.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="empty-state inline">
                            <div className="empty-title">No execution records yet</div>
                            <div className="meta">
                              Adjust filters or run a workflow to generate auditable execution history.
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      historyPageRows.map((row) => (
                        <tr key={row.execution_id}>
                          <td>
                            <span
                              className={`badge ${
                                row.status === "success"
                                  ? "ok"
                                  : row.status === "failed"
                                    ? "fail"
                                    : row.status === "running"
                                      ? "running"
                                      : "dry"
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td>{row.workflow_name}</td>
                          <td className="mono">{row.workflow_id}</td>
                          <td>
                            <div className="engine-cell">
                              <img src={getEngineLogo(row.engine)} alt={row.engine} className="engine-logo sm" />
                              <span>{row.engine}</span>
                            </div>
                          </td>
                          <td>{row.stage || "-"}</td>
                          <td>{row.created_at}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                className="btn-secondary"
                                onClick={() => setOutputFromHistoryRow(row)}
                              >
                                View
                              </button>
                              <button
                                className="btn-primary"
                                onClick={() => prepareRerun(row)}
                              >
                                Rerun
                              </button>
                              <button
                                className="btn-danger"
                                onClick={() => deleteExecution(row.execution_id)}
                                disabled={busy.deleteId === row.execution_id}
                              >
                                {busy.deleteId === row.execution_id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="history-footer">
                <div className="meta">
                  Showing {historyPageRows.length} of {historyFilteredSorted.length} matching runs
                </div>
                <div className="actions">
                  <label className="pager-label">
                    Rows
                    <select
                      value={historyPageSize}
                      onChange={(e) => setHistoryPageSize(Number(e.target.value))}
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                  <button
                    className="btn-secondary"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                  >
                    Previous
                  </button>
                  <div className="meta pager-meta">
                    Page {historyPage} of {historyTotalPages}
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                    disabled={historyPage >= historyTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="panel history-output-bottom">
                <h2>Execution Output</h2>
                <p className="sub">Select "View" from any run to inspect output details.</p>
                {hasOutputData ? (
                  <>
                    <div className="actions">
                      <button className="btn-secondary" onClick={copyOutput}>
                        Copy Output
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => setShowFullOutput((v) => !v)}
                        disabled={!outputFullText}
                      >
                        {showFullOutput ? "Show Processed Output" : "Show Full Response"}
                      </button>
                    </div>
                    <pre className="output">{renderedOutput}</pre>
                  </>
                ) : (
                  <div className="empty-state output-empty">
                    <div className="empty-title">Nothing selected</div>
                    <div className="meta">Click "View" on a history row to inspect its execution output.</div>
                  </div>
                )}
              </div>
            </section>
          )}
          </main>
        </div>
      )}

      <div className={`toast ${toast.show ? "show" : ""} ${toast.type || ""}`}>{toast.message}</div>
    </div>
  );
}

export default App;
