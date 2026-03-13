# syntax=docker/dockerfile:1

FROM node:20-alpine AS ui-builder
WORKDIR /app/ui

COPY ui/package*.json ./
RUN npm ci

COPY ui/ ./
RUN npm run build


FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend/ /app/backend/
COPY --from=ui-builder /app/ui/dist /app/ui/dist

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "backend"]
