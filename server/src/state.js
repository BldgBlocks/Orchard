import fs from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from './config.js';

const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const HISTORY_LIMIT = 10;
const LOG_LIMIT = 160;

const clients = new Set();
const activeOperations = new Map();
let recentHistory = [];

function sortByDateDescending(left, right) {
  return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime();
}

function serializeOperation(operation) {
  return {
    id: operation.id,
    label: operation.label,
    kind: operation.kind,
    mode: operation.mode,
    status: operation.status,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt || null,
    total: operation.total,
    completed: operation.completed,
    updated: operation.updated || 0,
    failed: operation.failed,
    projects: Object.values(operation.projects).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    logs: operation.logs.slice(-24),
  };
}

function snapshot() {
  return {
    activeOperations: Array.from(activeOperations.values())
      .sort(sortByDateDescending)
      .map(serializeOperation),
    recentHistory,
  };
}

function sendEvent(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast() {
  const payload = snapshot();
  for (const response of clients) {
    sendEvent(response, 'snapshot', payload);
  }
}

async function persistHistory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HISTORY_PATH, `${JSON.stringify(recentHistory, null, 2)}\n`);
}

function toHistoryEntry(operation) {
  return {
    ...serializeOperation(operation),
    logs: operation.logs.slice(-18),
  };
}

export async function initState() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      recentHistory = parsed.slice(0, HISTORY_LIMIT);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read operation history.', error);
    }
  }
}

export function subscribe(response) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();

  clients.add(response);
  sendEvent(response, 'snapshot', snapshot());

  const keepAlive = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, 15000);

  response.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(response);
    response.end();
  });
}

export function createOperation({ id, label, kind, mode, projects }) {
  const startedAt = new Date().toISOString();
  const operation = {
    id,
    label,
    kind,
    mode,
    status: 'running',
    startedAt,
    finishedAt: null,
    total: projects.length,
    completed: 0,
    updated: 0,
    failed: 0,
    logs: [],
    projects: Object.fromEntries(
      projects.map((project) => [
        project.id,
        {
          id: project.id,
          name: project.name,
          relativePath: project.relativePath,
          rollbackHints: [],
          status: 'queued',
          summary: 'Waiting for its turn.',
          startedAt: null,
          finishedAt: null,
        },
      ]),
    ),
  };

  activeOperations.set(id, operation);
  broadcast();

  return serializeOperation(operation);
}

export function updateOperation(operationId, updateFn) {
  const operation = activeOperations.get(operationId);
  if (!operation) {
    return null;
  }

  updateFn(operation);
  broadcast();
  return serializeOperation(operation);
}

export function updateProjectState(operationId, projectId, patch) {
  return updateOperation(operationId, (operation) => {
    const currentProject = operation.projects[projectId];
    if (!currentProject) {
      return;
    }

    operation.projects[projectId] = {
      ...currentProject,
      ...patch,
    };
  });
}

export function appendProjectRollbackHints(operationId, projectId, rollbackHints) {
  return updateOperation(operationId, (operation) => {
    const currentProject = operation.projects[projectId];
    if (!currentProject || !Array.isArray(rollbackHints) || rollbackHints.length === 0) {
      return;
    }

    const existingHints = Array.isArray(currentProject.rollbackHints)
      ? currentProject.rollbackHints
      : [];
    const mergedHints = new Map(
      existingHints.map((hint) => [`${hint.targetLabel}::${hint.service}`, hint]),
    );

    for (const hint of rollbackHints) {
      mergedHints.set(`${hint.targetLabel}::${hint.service}`, hint);
    }

    operation.projects[projectId] = {
      ...currentProject,
      rollbackHints: Array.from(mergedHints.values()).sort((left, right) => {
        const leftKey = `${left.targetLabel}::${left.service}`;
        const rightKey = `${right.targetLabel}::${right.service}`;
        return leftKey.localeCompare(rightKey);
      }),
    };
  });
}

export function appendOperationLog(operationId, entry) {
  return updateOperation(operationId, (operation) => {
    operation.logs.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: entry.level || 'info',
      source: entry.source || 'system',
      message: entry.message,
    });

    if (operation.logs.length > LOG_LIMIT) {
      operation.logs = operation.logs.slice(-LOG_LIMIT);
    }
  });
}

export async function finalizeOperation(operationId, updateFn) {
  const operation = activeOperations.get(operationId);
  if (!operation) {
    return null;
  }

  if (updateFn) {
    updateFn(operation);
  }

  if (!operation.finishedAt) {
    operation.finishedAt = new Date().toISOString();
  }

  const historyEntry = toHistoryEntry(operation);
  activeOperations.delete(operationId);
  recentHistory = [historyEntry, ...recentHistory].slice(0, HISTORY_LIMIT);

  await persistHistory();
  broadcast();

  return historyEntry;
}

export function getActivitySnapshot() {
  return snapshot();
}

export function hasActiveOperations() {
  return activeOperations.size > 0;
}

export function getActiveOperationMetadata() {
  return Array.from(activeOperations.values()).map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    mode: operation.mode,
    projectRelativePaths: Object.values(operation.projects)
      .map((project) => project.relativePath)
      .sort((left, right) => left.localeCompare(right)),
  }));
}
