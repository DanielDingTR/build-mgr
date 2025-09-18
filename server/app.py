from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_BUILD_ROOT = BASE_DIR.parent / "build_outputs"
BUILD_ROOT = Path(os.environ.get("ZEPHYR_BUILD_OUTPUT_ROOT", DEFAULT_BUILD_ROOT)).resolve()

app = FastAPI(title="Zephyr Build Output Manager", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_build_dir(build_id: str) -> Path:
    build_dir = (BUILD_ROOT / build_id).resolve()
    if not build_dir.exists() or not build_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Build '{build_id}' not found")
    if BUILD_ROOT not in build_dir.parents and build_dir != BUILD_ROOT:
        raise HTTPException(status_code=400, detail="Invalid build identifier")
    return build_dir


def _load_metadata(build_dir: Path) -> Dict[str, Any]:
    metadata_path = build_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=500, detail=f"Missing metadata.json for build '{build_dir.name}'")
    try:
        return json.loads(metadata_path.read_text())
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"metadata.json is invalid JSON: {exc}") from exc


def _count_artifacts(artifacts_dir: Path) -> int:
    if not artifacts_dir.exists():
        return 0
    return sum(1 for path in artifacts_dir.rglob("*") if path.is_file())


def _list_artifacts(artifacts_dir: Path) -> List[Dict[str, Any]]:
    if not artifacts_dir.exists():
        return []
    artifacts: List[Dict[str, Any]] = []
    for file_path in sorted(artifacts_dir.rglob("*")):
        if not file_path.is_file():
            continue
        stat = file_path.stat()
        artifacts.append(
            {
                "name": str(file_path.relative_to(artifacts_dir)),
                "size_bytes": stat.st_size,
                "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
            }
        )
    return artifacts


class BuildSummary(BaseModel):
    id: str
    application: Optional[str]
    board: Optional[str]
    status: Optional[str]
    created_at: Optional[str]
    completed_at: Optional[str]
    duration_seconds: Optional[int]
    warnings: Optional[int]
    errors: Optional[int]
    artifact_count: int
    log_bytes: int


class BuildDetail(BuildSummary):
    toolchain: Optional[str]
    west_command: Optional[str]
    build_dir: Optional[str]
    metadata: Dict[str, Any]
    artifacts: List[Dict[str, Any]]


@app.get("/api/builds", response_model=List[BuildSummary])
def list_builds() -> List[BuildSummary]:
    if not BUILD_ROOT.exists():
        return []

    builds: List[BuildSummary] = []
    for entry in sorted(BUILD_ROOT.iterdir(), reverse=True):
        if not entry.is_dir():
            continue
        try:
            metadata = _load_metadata(entry)
        except HTTPException:
            continue

        artifacts_dir = entry / "artifacts"
        log_path = entry / "build.log"
        log_bytes = log_path.stat().st_size if log_path.exists() else 0
        builds.append(
            BuildSummary(
                id=metadata.get("id", entry.name),
                application=metadata.get("application"),
                board=metadata.get("board"),
                status=metadata.get("status"),
                created_at=metadata.get("created_at"),
                completed_at=metadata.get("completed_at"),
                duration_seconds=metadata.get("duration_seconds"),
                warnings=metadata.get("warnings"),
                errors=metadata.get("errors"),
                artifact_count=_count_artifacts(artifacts_dir),
                log_bytes=log_bytes,
            )
        )
    return builds


@app.get("/api/builds/{build_id}", response_model=BuildDetail)
def get_build(build_id: str) -> BuildDetail:
    build_dir = _safe_build_dir(build_id)
    metadata = _load_metadata(build_dir)
    artifacts_dir = build_dir / "artifacts"
    log_path = build_dir / "build.log"

    return BuildDetail(
        id=metadata.get("id", build_dir.name),
        application=metadata.get("application"),
        board=metadata.get("board"),
        status=metadata.get("status"),
        created_at=metadata.get("created_at"),
        completed_at=metadata.get("completed_at"),
        duration_seconds=metadata.get("duration_seconds"),
        warnings=metadata.get("warnings"),
        errors=metadata.get("errors"),
        toolchain=metadata.get("toolchain"),
        west_command=metadata.get("west_command"),
        build_dir=metadata.get("build_dir"),
        artifact_count=_count_artifacts(artifacts_dir),
        artifacts=_list_artifacts(artifacts_dir),
        log_bytes=log_path.stat().st_size if log_path.exists() else 0,
        metadata=metadata,
    )


@app.get("/api/builds/{build_id}/log")
def get_build_log(build_id: str, tail: Optional[int] = None):
    build_dir = _safe_build_dir(build_id)
    log_path = build_dir / "build.log"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log file not found")

    log_text = log_path.read_text(errors="replace")
    if tail is not None and tail > 0:
        lines = log_text.splitlines()
        log_text = "\n".join(lines[-tail:])

    return PlainTextResponse(log_text)


@app.get("/api/builds/{build_id}/artifacts/{artifact_path:path}")
def download_artifact(build_id: str, artifact_path: str):
    build_dir = _safe_build_dir(build_id)
    artifacts_dir = build_dir / "artifacts"
    if not artifacts_dir.exists():
        raise HTTPException(status_code=404, detail="No artifacts directory for this build")

    requested_path = (artifacts_dir / artifact_path).resolve()
    if artifacts_dir not in requested_path.parents and requested_path != artifacts_dir:
        raise HTTPException(status_code=400, detail="Invalid artifact path")
    if not requested_path.exists() or not requested_path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")

    return FileResponse(requested_path)


@app.delete("/api/builds/{build_id}/artifacts/{artifact_path:path}", status_code=204)
def delete_artifact(build_id: str, artifact_path: str):
    build_dir = _safe_build_dir(build_id)
    artifacts_dir = build_dir / "artifacts"
    if not artifacts_dir.exists():
        raise HTTPException(status_code=404, detail="No artifacts directory for this build")

    requested_path = (artifacts_dir / artifact_path).resolve()
    if artifacts_dir not in requested_path.parents and requested_path != artifacts_dir:
        raise HTTPException(status_code=400, detail="Invalid artifact path")
    if not requested_path.exists() or not requested_path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")

    requested_path.unlink()
    return Response(status_code=204)


@app.get("/api/status")
def status():
    return {
        "build_root": str(BUILD_ROOT),
        "build_count": len([p for p in BUILD_ROOT.iterdir() if p.is_dir()]) if BUILD_ROOT.exists() else 0,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
