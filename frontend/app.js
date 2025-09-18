const API_BASE = window.__ZEPHYR_BUILD_API__ || '/api';

const state = {
  builds: [],
  selectedBuildId: null,
  tailLines: null,
};

const buildListElement = document.getElementById('build-list');
const buildDetailsElement = document.getElementById('build-details');
const placeholderElement = document.getElementById('placeholder');
const summaryListElement = document.getElementById('summary-list');
const artifactTableBody = document.querySelector('#artifact-table tbody');
const artifactCountElement = document.getElementById('artifact-count');
const artifactEmptyElement = document.getElementById('artifact-empty');
const logTextarea = document.getElementById('build-log');
const tailSelect = document.getElementById('tail-lines');
const detailTitle = document.getElementById('detail-title');
const emptyStateElement = document.getElementById('empty-state');

const statusClass = (status) => {
  if (!status) return 'unknown';
  const normalized = status.toLowerCase();
  if (normalized.includes('success')) return 'success';
  if (normalized.includes('pass')) return 'success';
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed';
  return 'unknown';
};

const formatDateTime = (isoString) => {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString();
  } catch (err) {
    return isoString;
  }
};

const formatDuration = (seconds) => {
  if (seconds === undefined || seconds === null) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const buildDownloadUrl = (buildId, artifactName) => {
  const encodedArtifact = artifactName
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${API_BASE}/builds/${encodeURIComponent(buildId)}/artifacts/${encodedArtifact}`;
};

const selectBuild = async (buildId) => {
  state.selectedBuildId = buildId;
  await Promise.all([
    loadBuildDetails(buildId),
    loadBuildLog(buildId, state.tailLines),
  ]);
  renderBuildList();
};

const loadBuilds = async () => {
  document.getElementById('refresh-builds').disabled = true;
  try {
    const response = await fetch(`${API_BASE}/builds`);
    if (!response.ok) {
      throw new Error(`Failed to fetch builds: ${response.status}`);
    }
    const data = await response.json();
    state.builds = data;
    renderBuildList();
    if (state.builds.length === 0) {
      emptyStateElement.hidden = false;
      buildDetailsElement.hidden = true;
      placeholderElement.textContent = 'No builds available yet.';
    } else {
      emptyStateElement.hidden = true;
      if (!state.selectedBuildId) {
        await selectBuild(state.builds[0].id);
      }
    }
  } catch (error) {
    console.error(error);
    emptyStateElement.hidden = false;
    emptyStateElement.textContent = 'Unable to load builds. Check if the backend is running.';
  } finally {
    document.getElementById('refresh-builds').disabled = false;
  }
};

const renderBuildList = () => {
  buildListElement.innerHTML = '';
  state.builds.forEach((build) => {
    const item = document.createElement('li');
    item.className = 'build-card';
    if (build.id === state.selectedBuildId) {
      item.classList.add('active');
    }

    const title = document.createElement('h3');
    title.textContent = build.application || build.id;
    item.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'build-meta';

    const status = document.createElement('span');
    status.className = `status ${statusClass(build.status)}`;
    status.textContent = build.status || 'unknown';
    meta.appendChild(status);

    const board = document.createElement('span');
    board.textContent = build.board || '—';
    meta.appendChild(board);

    const created = document.createElement('span');
    created.textContent = formatDateTime(build.created_at);
    meta.appendChild(created);

    const warnings = document.createElement('span');
    warnings.textContent = `⚠️ ${build.warnings ?? 0}`;
    meta.appendChild(warnings);

    const artifacts = document.createElement('span');
    artifacts.textContent = `🎯 ${build.artifact_count}`;
    meta.appendChild(artifacts);

    item.appendChild(meta);
    item.addEventListener('click', () => selectBuild(build.id));
    buildListElement.appendChild(item);
  });
};

const loadBuildDetails = async (buildId) => {
  try {
    const response = await fetch(`${API_BASE}/builds/${encodeURIComponent(buildId)}`);
    if (!response.ok) {
      throw new Error('Failed to load build details');
    }
    const build = await response.json();
    detailTitle.textContent = `Build Details – ${build.application || build.id}`;
    placeholderElement.hidden = true;
    buildDetailsElement.hidden = false;

    renderSummary(build);
    renderArtifacts(build);
  } catch (error) {
    console.error(error);
    buildDetailsElement.hidden = true;
    placeholderElement.hidden = false;
    placeholderElement.textContent = 'Unable to load build details.';
  }
};

const renderSummary = (build) => {
  summaryListElement.innerHTML = '';
  const summaryItems = [
    { label: 'Build ID', value: build.id },
    { label: 'Board', value: build.board || '—' },
    { label: 'Status', value: build.status || 'unknown' },
    { label: 'Created', value: formatDateTime(build.created_at) },
    { label: 'Completed', value: formatDateTime(build.completed_at) },
    { label: 'Duration', value: formatDuration(build.duration_seconds) },
    { label: 'Warnings', value: build.warnings ?? '—' },
    { label: 'Errors', value: build.errors ?? '—' },
    { label: 'Toolchain', value: build.toolchain || '—' },
    { label: 'west command', value: build.west_command || '—' },
    { label: 'Log size', value: formatBytes(build.log_bytes) },
  ];

  summaryItems.forEach(({ label, value }) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    summaryListElement.append(dt, dd);
  });
};

const renderArtifacts = (build) => {
  artifactTableBody.innerHTML = '';
  const artifacts = build.artifacts || [];
  artifactCountElement.textContent = `${artifacts.length} files`;

  if (artifacts.length === 0) {
    artifactEmptyElement.hidden = false;
    return;
  }
  artifactEmptyElement.hidden = true;

  artifacts.forEach((artifact) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = artifact.name;
    row.appendChild(nameCell);

    const sizeCell = document.createElement('td');
    sizeCell.textContent = formatBytes(artifact.size_bytes);
    row.appendChild(sizeCell);

    const modifiedCell = document.createElement('td');
    modifiedCell.textContent = formatDateTime(artifact.modified_at);
    row.appendChild(modifiedCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'action-button download';
    downloadButton.textContent = 'Download';
    downloadButton.addEventListener('click', () => {
      window.open(buildDownloadUrl(build.id, artifact.name), '_blank');
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'action-button delete';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      if (!confirm(`Delete artifact ${artifact.name}?`)) return;
      const response = await fetch(buildDownloadUrl(build.id, artifact.name), { method: 'DELETE' });
      if (response.ok || response.status === 204) {
        await loadBuildDetails(build.id);
      } else {
        alert('Failed to delete artifact.');
      }
    });

    actionsCell.append(downloadButton, deleteButton);
    row.appendChild(actionsCell);
    artifactTableBody.appendChild(row);
  });
};

const loadBuildLog = async (buildId, tail) => {
  try {
    const url = new URL(`${API_BASE}/builds/${encodeURIComponent(buildId)}/log`, window.location.origin);
    if (tail) {
      url.searchParams.set('tail', tail);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to load build log');
    }
    logTextarea.value = await response.text();
  } catch (error) {
    console.error(error);
    logTextarea.value = 'Unable to load log file. Ensure the backend can access the log.';
  }
};

// Event bindings
document.getElementById('refresh-builds').addEventListener('click', loadBuilds);
tailSelect.addEventListener('change', async (event) => {
  const value = event.target.value;
  state.tailLines = value ? Number.parseInt(value, 10) : null;
  if (state.selectedBuildId) {
    await loadBuildLog(state.selectedBuildId, state.tailLines);
  }
});

document.getElementById('refresh-log').addEventListener('click', async () => {
  if (state.selectedBuildId) {
    await loadBuildLog(state.selectedBuildId, state.tailLines);
  }
});

const init = async () => {
  await loadBuilds();
};

init();
