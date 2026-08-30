# Minimal FastAPI service backed by native Strands Skills and Grafana MCP.
FROM python:3.13-slim
RUN pip install --no-cache-dir 'strands-agents[openai]==1.54.0' fastapi uvicorn
WORKDIR /app
COPY agent/ ./agent/
CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8085", "--app-dir", "agent"]
