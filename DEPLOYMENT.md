# Deployment Guide

This guide walks through deploying the Build Output Manager in a production-like environment. It covers preparing the application, configuring runtime settings, and serving both the FastAPI backend and the static frontend.

## 1. Prerequisites

- Linux host or container image with Python 3.10+
- `git` and `make` (optional, for convenience)
- Reverse proxy such as Nginx or Caddy for TLS termination (recommended)
- Optional: Docker or Podman if you plan to containerize the service

## 2. Directory layout

Clone the repository and ensure that the backend, frontend, and build output archive are present:

```bash
git clone https://github.com/your-org/build-mgr.git
cd build-mgr
```

By default, build artifacts are read from `build_outputs/`. For production, mount or sync your CI artifact directory into this location or point the application at a different path via `ZEPHYR_BUILD_OUTPUT_ROOT`.

## 3. Python virtual environment setup

Create an isolated environment, install dependencies, and run database migrations (none required for the current version):

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4. Application configuration

The service reads environment variables at startup:

| Variable | Description | Default |
| --- | --- | --- |
| `ZEPHYR_BUILD_OUTPUT_ROOT` | Absolute path to the archived build outputs | `<repo>/build_outputs` |
| `PORT` | Port for the ASGI server (set in the process manager) | `8000` |

Ensure the configured directory is readable by the service user. If the build archive resides on a network filesystem, mount it before starting the service.

## 5. Running the backend with a production ASGI server

Use `uvicorn` or `gunicorn` with the `uvicorn.workers.UvicornWorker` worker class. Example `systemd` service unit:

```ini
[Unit]
Description=Zephyr Build Output Manager API
After=network.target

[Service]
User=buildmgr
Group=buildmgr
WorkingDirectory=/opt/build-mgr/server
Environment="ZEPHYR_BUILD_OUTPUT_ROOT=/mnt/build-archive"
Environment="PATH=/opt/build-mgr/server/.venv/bin"
ExecStart=/opt/build-mgr/server/.venv/bin/gunicorn app:app \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl enable build-mgr
sudo systemctl start build-mgr
```

## 6. Serving the frontend

The `frontend/` directory is a static site. For production:

1. Build or minify assets if desired (the current assets are plain HTML/CSS/JS).
2. Serve the directory through your reverse proxy or a CDN.
3. Ensure the UI can reach the API by exposing `/api` on the same origin or by configuring `window.__ZEPHYR_BUILD_API__` in `index.html` to point at the API host.

Example Nginx server block that proxies API requests and serves static assets:

```nginx
server {
    listen 80;
    server_name build.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        root /opt/build-mgr/frontend;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

For HTTPS, add TLS configuration or terminate TLS at a load balancer.

## 7. Containerized deployment (optional)

Create a multi-stage Docker image to serve both API and static files. A sample `Dockerfile` outline:

```Dockerfile
# Stage 1 - build frontend (optional if using static assets as-is)
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/ .
# npm install && npm run build # if you introduce a build step

# Stage 2 - runtime
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY server/requirements.txt ./server/requirements.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r server/requirements.txt
COPY server/ ./server/
COPY --from=frontend /app/frontend /app/frontend
COPY build_outputs/ /app/build_outputs
ENV PATH="/opt/venv/bin:$PATH"
ENV ZEPHYR_BUILD_OUTPUT_ROOT="/app/build_outputs"
EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build and run the container:

```bash
docker build -t build-mgr .
docker run -d -p 8000:8000 \
  -v /mnt/build-archive:/app/build_outputs:ro \
  --name build-mgr build-mgr
```

## 8. Health checks and monitoring

- The API exposes `GET /api/status` as a readiness probe.
- Add log rotation for gunicorn/uvicorn logs via `logrotate` or your process manager.
- Monitor disk usage of the artifact archive and prune old builds as needed.

## 9. Upgrade procedure

1. Pull the latest changes:
   ```bash
   git fetch --all
   git checkout main
   git pull --ff-only
   ```
2. Reinstall dependencies if `requirements.txt` changed.
3. Restart the ASGI service (`systemctl restart build-mgr` or recreate the container).

## 10. Troubleshooting

- **HTTP 404**: Ensure `ZEPHYR_BUILD_OUTPUT_ROOT` points to the correct directory and that the `metadata.json` files are present.
- **Permission denied**: Run the service under a user that can read the build archive.
- **CORS issues**: Update `allow_origins` in `server/app.py` or serve the frontend and backend on the same origin.
- **Slow responses**: Increase worker count or move the build archive to faster storage.

Following these steps will get the Build Output Manager running reliably in a production environment.
