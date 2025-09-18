# Build Output Manager

A lightweight build monitoring dashboard that scans build outputs, exposes them through a REST API, and ships with a static UI for browsing logs and artifacts. Useful for teams that archive build directories and want quick visibility into results without cracking open the terminal.

## Features

- Detects build folders (`metadata.json`, `build.log`, and `artifacts/`) and surfaces key metadata
- Streams build logs with optional tailing
- Lists generated artifacts with size/mtime and enables download or deletion
- Simple static frontend that consumes the API and provides a clean dashboard experience
- Configurable root path via `ZEPHYR_BUILD_OUTPUT_ROOT`

## Repository layout

```
.
├── build_outputs/                    # Sample build outputs (replace with your own)
│   ├── 2024-06-10T101500_sample_app/
│   │   ├── artifacts/
│   │   ├── build.log
│   │   └── metadata.json
│   └── 2024-06-11T154500_sensor_node/
│       ├── artifacts/
│       ├── build.log
│       └── metadata.json
├── frontend/                         # Static dashboard (HTML/CSS/JS)
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── server/                           # FastAPI backend
    ├── app.py
    └── requirements.txt
```

## Backend setup (FastAPI)

1. Create a virtual environment and install dependencies:
   ```bash
   cd server
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. (Optional) Point the API at a different build archive root:
   ```bash
   export ZEPHYR_BUILD_OUTPUT_ROOT=/path/to/your/west/build/outputs
   ```

3. Run the API:
   ```bash
   uvicorn app:app --reload --port 8000
   ```

   The API will be available at `http://localhost:8000`. Key endpoints:
   - `GET /api/builds` – build summaries
   - `GET /api/builds/{build_id}` – detailed metadata + artifact list
   - `GET /api/builds/{build_id}/log?tail=250` – plain-text build log
   - `GET /api/builds/{build_id}/artifacts/{path}` – download artifact
   - `DELETE /api/builds/{build_id}/artifacts/{path}` – delete artifact
   - `GET /api/status` – quick health check

## Frontend setup (static site)

1. Serve the `frontend/` directory with any static file server, for example:
   ```bash
   cd frontend
   python -m http.server 5173
   ```

2. Open `http://localhost:5173` in a browser. By default the UI talks to `http://localhost:5173/api`, so proxying or running both frontend and backend from the same origin is recommended. To point the UI at a different API base, add a script tag before `app.js` in `index.html`:
   ```html
   <script>
     window.__ZEPHYR_BUILD_API__ = 'http://localhost:8000/api';
   </script>
   ```

## Adapting to real build pipelines

- Replace the contents of `build_outputs/` with your own build directories or update `ZEPHYR_BUILD_OUTPUT_ROOT` to target an NFS share or CI artifact archive.
- Ensure each build folder contains a `metadata.json`, `build.log`, and optional `artifacts/` subdirectory. The API tolerates missing fields but requires valid JSON.
- Extend `server/app.py` to ingest additional metadata (e.g., footprint reports, warnings.xml) as needed.
- Hook into CI by copying west build directories into an archival location and scheduling a cron job or CI step to keep the folder up to date.

## Next steps

- Persist metadata in a lightweight database (SQLite) for faster querying
- Add authentication/authorization for artifact deletion
- Integrate websocket log streaming for live builds
- Expand UI search, filtering, and diffing capabilities

Happy debugging!
