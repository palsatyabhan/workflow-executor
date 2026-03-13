SHELL := /bin/bash

APP_DIR := backend
UI_DIR := ui
VENV_DIR := $(APP_DIR)/.venv
PYTHON := $(VENV_DIR)/bin/python
UVICORN := $(VENV_DIR)/bin/uvicorn
PID_FILE := .app.pid
LOG_FILE := .app.log
HOST := 0.0.0.0
PORT := 8000

.PHONY: help setup setup-ui run run-ui dev stop restart status logs clean build-ui

help:
	@echo "Available targets:"
	@echo "  make setup    - Create virtualenv and install backend dependencies"
	@echo "  make setup-ui - Install React UI dependencies"
	@echo "  make run      - Start backend API in background (PID file: $(PID_FILE))"
	@echo "  make run-ui   - Start React UI dev server on port 5173"
	@echo "  make dev      - Start backend and UI together"
	@echo "  make build-ui - Build React UI for production into ui/dist"
	@echo "  make stop     - Stop app using PID file"
	@echo "  make restart  - Restart app"
	@echo "  make status   - Show whether app is running"
	@echo "  make logs     - Show recent application logs"
	@echo "  make clean    - Remove PID and log files"

setup:
	@if [ ! -d "$(VENV_DIR)" ]; then \
		echo "Creating virtual environment..."; \
		python3 -m venv "$(VENV_DIR)"; \
	fi
	@echo "Installing dependencies..."
	@"$(PYTHON)" -m pip install -r "$(APP_DIR)/requirements.txt"

setup-ui:
	@echo "Installing UI dependencies..."
	@cd "$(UI_DIR)" && npm install

run:
	@if [ -f "$(PID_FILE)" ]; then \
		PID=$$(cat "$(PID_FILE)"); \
		if kill -0 "$$PID" 2>/dev/null; then \
			echo "App is already running (PID $$PID)."; \
			exit 0; \
		else \
			echo "Removing stale PID file."; \
			rm -f "$(PID_FILE)"; \
		fi; \
	fi
	@if [ ! -x "$(UVICORN)" ]; then \
		echo "Environment not ready. Running setup..."; \
		$(MAKE) setup; \
	fi
	@echo "Starting app on $(HOST):$(PORT)..."
	@nohup "$(UVICORN)" app.main:app --reload --host "$(HOST)" --port "$(PORT)" \
		--app-dir "$(APP_DIR)" >"$(LOG_FILE)" 2>&1 & echo $$! >"$(PID_FILE)"
	@sleep 1
	@PID=$$(cat "$(PID_FILE)"); \
	if kill -0 "$$PID" 2>/dev/null; then \
		echo "App started (PID $$PID)."; \
		echo "Open http://localhost:$(PORT)"; \
	else \
		echo "Failed to start app. Check $(LOG_FILE)."; \
		rm -f "$(PID_FILE)"; \
		exit 1; \
	fi

stop:
	@if [ ! -f "$(PID_FILE)" ]; then \
		echo "App is not running (no PID file)."; \
		exit 0; \
	fi
	@PID=$$(cat "$(PID_FILE)"); \
	if kill -0 "$$PID" 2>/dev/null; then \
		echo "Stopping app (PID $$PID)..."; \
		kill "$$PID"; \
		sleep 1; \
		if kill -0 "$$PID" 2>/dev/null; then \
			echo "Force stopping app (PID $$PID)..."; \
			kill -9 "$$PID"; \
		fi; \
		echo "App stopped."; \
	else \
		echo "Process $$PID is not running. Cleaning stale PID file."; \
	fi
	@rm -f "$(PID_FILE)"

restart: stop run

status:
	@if [ -f "$(PID_FILE)" ]; then \
		PID=$$(cat "$(PID_FILE)"); \
		if kill -0 "$$PID" 2>/dev/null; then \
			echo "App is running (PID $$PID) on http://localhost:$(PORT)"; \
		else \
			echo "PID file exists but process is not running."; \
			exit 1; \
		fi; \
	else \
		echo "App is not running."; \
		exit 1; \
	fi

logs:
	@if [ -f "$(LOG_FILE)" ]; then \
		tail -n 120 "$(LOG_FILE)"; \
	else \
		echo "No log file found ($(LOG_FILE))."; \
	fi

clean:
	@rm -f "$(PID_FILE)" "$(LOG_FILE)"
	@echo "Cleaned runtime artifacts."

run-ui:
	@cd "$(UI_DIR)" && npm run dev

dev: run
	@$(MAKE) run-ui

build-ui:
	@cd "$(UI_DIR)" && npm run build
