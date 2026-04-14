import { nanoid } from 'nanoid';

import { discoverProjects, hasImageUpdates, runComposeCommand, sanitizeSensitiveText } from './projects.js';
import {
  appendOperationLog,
  createOperation,
  finalizeOperation,
  getActiveOperationMetadata,
  updateOperation,
  updateProjectState,
} from './state.js';

const controllers = new Map();
const ACTION_QUEUE_LIMIT = clamp(Number(process.env.ACTION_QUEUE_LIMIT) || 50, 1, 200);
const ACTION_COOLDOWN_MS = clamp(Number(process.env.ACTION_COOLDOWN_MS) || 1000, 0, 60000);
let lastQueuedAt = 0;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function createAbortError() {
  const error = new Error('Operation cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message || '');
}

function formatError(error) {
  return sanitizeSensitiveText(error?.result?.combinedOutput?.trim() || error?.message || 'Unexpected failure.');
}

function createQueueError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function appendProjectLog(operationId, project, message, level = 'info') {
  appendOperationLog(operationId, {
    level,
    source: project.name,
    message: sanitizeSensitiveText(message),
  });
}

function composeTargetLabel(app, composeTarget) {
  if (!composeTarget?.relativePath || composeTarget.relativePath === app.relativePath) {
    return app.name;
  }

  return `${app.name} · ${composeTarget.relativePath}`;
}

async function runQueue(items, limit, signal, worker) {
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      if (signal.aborted) {
        return;
      }

      const currentIndex = cursor;
      cursor += 1;
      await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

async function processComposeTarget({ operationId, app, composeTarget, mode, signal }) {
  if (signal.aborted) {
    throw createAbortError();
  }

  const targetLabel = composeTargetLabel(app, composeTarget);
  const wasRunning = Number(composeTarget.runningServices || 0) > 0;

  try {
    let shouldRestart = false;

    if (mode === 'stop-only') {
      appendProjectLog(operationId, app, `${targetLabel}: stopping compose app.`);
      await runComposeCommand(composeTarget.absolutePath, ['down'], {
        signal,
        onOutput: (entry) => appendProjectLog(operationId, app, `${targetLabel}: ${entry.message}`, entry.level),
      });
      appendProjectLog(operationId, app, `${targetLabel}: compose folder stopped.`);
      return 'stopped';
    } else if (mode === 'start-only') {
      appendProjectLog(operationId, app, `${targetLabel}: starting compose app in detached mode.`);
      await runComposeCommand(composeTarget.absolutePath, ['up', '-d'], {
        signal,
        onOutput: (entry) => appendProjectLog(operationId, app, `${targetLabel}: ${entry.message}`, entry.level),
      });
      appendProjectLog(operationId, app, `${targetLabel}: compose folder started.`);
      return 'started';
    } else if (mode === 'restart-only') {
      if (!wasRunning) {
        appendProjectLog(operationId, app, `${targetLabel}: compose folder is already stopped. Leaving it stopped.`, 'info');
        return 'skipped';
      }

      appendProjectLog(operationId, app, `${targetLabel}: skipping pull and restarting the compose stack.`);
      shouldRestart = true;
    } else if (mode === 'force-update') {
      appendProjectLog(operationId, app, `${targetLabel}: pulling latest images before restart.`);
      await runComposeCommand(composeTarget.absolutePath, ['pull', '-q'], {
        signal,
        onOutput: (entry) => appendProjectLog(operationId, app, `${targetLabel}: ${entry.message}`, entry.level),
      });

      if (!wasRunning) {
        appendProjectLog(operationId, app, `${targetLabel}: images were checked, but this compose folder was already stopped. Leaving it stopped.`, 'info');
        return 'skipped';
      }

      shouldRestart = true;
    } else {
      appendProjectLog(operationId, app, `${targetLabel}: checking for image updates.`);
      const pullResult = await runComposeCommand(composeTarget.absolutePath, ['pull'], {
        signal,
        onOutput: (entry) => appendProjectLog(operationId, app, `${targetLabel}: ${entry.message}`, entry.level),
      });

      shouldRestart = hasImageUpdates(pullResult.combinedOutput);
      appendProjectLog(
        operationId,
        app,
        shouldRestart
          ? `${targetLabel}: new image data was pulled. Restart required.`
          : `${targetLabel}: no new image download detected. Leaving this compose folder alone.`,
      );

      if (shouldRestart && !wasRunning) {
        appendProjectLog(operationId, app, `${targetLabel}: updates were pulled, but this compose folder was already stopped. Leaving it stopped.`, 'info');
        return 'skipped';
      }
    }

    if (signal.aborted) {
      throw createAbortError();
    }

    if (!shouldRestart) {
      return 'skipped';
    }

    appendProjectLog(operationId, app, `${targetLabel}: stopping compose stack.`);
    await runComposeCommand(composeTarget.absolutePath, ['down'], {
      signal,
      onOutput: (entry) => appendProjectLog(operationId, app, `${targetLabel}: ${entry.message}`, entry.level),
    });

    if (signal.aborted) {
      throw createAbortError();
    }

    appendProjectLog(operationId, app, `${targetLabel}: starting compose stack in detached mode.`);
    await runComposeCommand(composeTarget.absolutePath, ['up', '-d'], {
      signal,
      onOutput: (entry) => appendProjectLog(operationId, app, `${targetLabel}: ${entry.message}`, entry.level),
    });

    appendProjectLog(operationId, app, `${targetLabel}: compose folder completed successfully.`);
    return 'completed';
  } catch (error) {
    const cancelled = signal.aborted || isAbortError(error);

    appendProjectLog(
      operationId,
      app,
      `${targetLabel}: ${cancelled ? 'Cancelled before completion.' : formatError(error)}`,
      cancelled ? 'warn' : 'error',
    );

    return cancelled ? 'cancelled' : 'failed';
  }
}

async function processProject({ operationId, project, mode, signal }) {
  if (signal.aborted) {
    throw createAbortError();
  }

  updateProjectState(operationId, project.id, {
    status: 'running',
    summary: `Running ${mode} across ${project.composeDirectoryCount} folder${project.composeDirectoryCount === 1 ? '' : 's'}.`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  let completedFolders = 0;
  let skippedFolders = 0;

  try {
    for (const composeTarget of project.composeDirectories) {
      if (signal.aborted) {
        throw createAbortError();
      }

      const outcome = await processComposeTarget({
        operationId,
        app: project,
        composeTarget,
        mode,
        signal,
      });

      if (outcome === 'completed') {
        completedFolders += 1;
      } else if (outcome === 'skipped') {
        skippedFolders += 1;
      } else if (outcome === 'failed' || outcome === 'cancelled') {
        throw outcome === 'cancelled' ? createAbortError() : new Error(`${composeTarget.relativePath} failed.`);
      }
    }

    const summary = mode === 'stop-only'
      ? `${project.composeDirectoryCount} folder${project.composeDirectoryCount === 1 ? '' : 's'} stopped.`
      : mode === 'start-only'
        ? `${project.composeDirectoryCount} folder${project.composeDirectoryCount === 1 ? '' : 's'} started.`
        : skippedFolders > 0
          ? `${completedFolders} folder${completedFolders === 1 ? '' : 's'} restarted, ${skippedFolders} skipped.`
          : completedFolders > 0
            ? `${completedFolders} folder${completedFolders === 1 ? '' : 's'} completed successfully.`
            : 'No newer images were downloaded for this app.';

    updateProjectState(operationId, project.id, {
      status: mode === 'stop-only'
        ? 'completed'
        : mode === 'start-only'
          ? 'completed'
          : completedFolders > 0
            ? 'completed'
            : 'skipped',
      summary,
      finishedAt: new Date().toISOString(),
    });

    return mode === 'stop-only' || mode === 'start-only'
      ? 'completed'
      : completedFolders > 0
        ? 'completed'
        : 'skipped';
  } catch (error) {
    const cancelled = signal.aborted || isAbortError(error);
    updateProjectState(operationId, project.id, {
      status: cancelled ? 'cancelled' : 'failed',
      summary: cancelled ? 'Cancelled before completion.' : formatError(error),
      finishedAt: new Date().toISOString(),
    });

    return cancelled ? 'cancelled' : 'failed';
  }
}

async function executeOperation({ operationId, projects, mode, concurrency, signal }) {
  let completed = 0;
  let failed = 0;
  let cancelled = false;

  await runQueue(projects, concurrency, signal, async (project) => {
    const outcome = await processProject({ operationId, project, mode, signal });
    completed += 1;

    if (outcome === 'failed') {
      failed += 1;
    }

    if (outcome === 'cancelled') {
      cancelled = true;
    }

    updateOperation(operationId, (operation) => {
      operation.completed = completed;
      operation.failed = failed;
      operation.status = cancelled ? 'cancelled' : 'running';
    });
  });

  await finalizeOperation(operationId, (operation) => {
    operation.completed = completed;
    operation.failed = failed;
    operation.status = signal.aborted || cancelled
      ? 'cancelled'
      : failed > 0
        ? 'attention'
        : 'completed';
    operation.finishedAt = new Date().toISOString();
  });
}

function normalizeProjectScope(projects) {
  return projects
    .map((project) => project.relativePath)
    .sort((left, right) => left.localeCompare(right));
}

function hasEquivalentOperation(activeOperations, mode, projectRelativePaths) {
  return activeOperations.some((operation) =>
    operation.mode === mode
      && operation.projectRelativePaths.length === projectRelativePaths.length
      && operation.projectRelativePaths.every((entry, index) => entry === projectRelativePaths[index]),
  );
}

export async function queueAction({ settings, mode, projectIds, maxParallelJobs, triggeredBy = 'user' }) {
  const discoveredProjects = await discoverProjects(settings);
  const requestedProjects = Array.isArray(projectIds) && projectIds.length > 0
    ? discoveredProjects.filter((project) => projectIds.includes(project.id))
    : Array.isArray(settings.batchTargetPaths) && settings.batchTargetPaths.length > 0
      ? discoveredProjects.filter((project) => settings.batchTargetPaths.includes(project.relativePath))
      : discoveredProjects;
  const skippedSelfProjects = settings.skipSelfProject
    ? requestedProjects.filter((project) => project.isSelfProject)
    : [];
  const selectedProjects = settings.skipSelfProject
    ? requestedProjects.filter((project) => !project.isSelfProject)
    : requestedProjects;

  if (selectedProjects.length === 0) {
    if (skippedSelfProjects.length > 0) {
      throw new Error('Selection only includes Orchard itself and self-skip is enabled.');
    }

    throw new Error('No managed apps were found for the current work path and selection.');
  }

  const selectedProjectRelativePaths = normalizeProjectScope(selectedProjects);
  const activeOperations = getActiveOperationMetadata();

  if (hasEquivalentOperation(activeOperations, mode, selectedProjectRelativePaths)) {
    throw createQueueError('An equivalent operation is already queued or running.', 'DUPLICATE_OPERATION');
  }

  if (activeOperations.length >= ACTION_QUEUE_LIMIT) {
    throw createQueueError(
      `The action queue is full. Wait for existing work to finish before queueing more than ${ACTION_QUEUE_LIMIT} operations.`,
      'QUEUE_LIMIT_REACHED',
    );
  }

  if (ACTION_COOLDOWN_MS > 0 && Date.now() - lastQueuedAt < ACTION_COOLDOWN_MS) {
    throw createQueueError('Another action was just queued. Wait a moment and try again.', 'ACTION_COOLDOWN');
  }

  const operationId = nanoid();
  const controller = new AbortController();
  const concurrency = clamp(
    Number(maxParallelJobs ?? settings.maxParallelJobs) || settings.maxParallelJobs,
    1,
    12,
  );

  controllers.set(operationId, controller);

  createOperation({
    id: operationId,
    label: triggeredBy === 'scheduler'
      ? 'Scheduled sweep for discovered apps'
      : selectedProjects.length === discoveredProjects.length
        ? 'Batch run for all discovered apps'
        : `Batch run for ${selectedProjects.length} selected app${selectedProjects.length === 1 ? '' : 's'}`,
    kind: triggeredBy === 'scheduler' ? 'scheduled' : selectedProjects.length === 1 ? 'project' : 'batch',
    mode,
    projects: selectedProjects,
  });

  appendOperationLog(operationId, {
    source: 'system',
    message: `Queued ${selectedProjects.length} app${selectedProjects.length === 1 ? '' : 's'} with concurrency ${concurrency}.`,
  });

  if (skippedSelfProjects.length > 0) {
    appendOperationLog(operationId, {
      source: 'system',
      level: 'warn',
      message: `Skipped ${skippedSelfProjects.length} self app${skippedSelfProjects.length === 1 ? '' : 's'} because self-skip is enabled.`,
    });
  }

  lastQueuedAt = Date.now();

  void executeOperation({
    operationId,
    projects: selectedProjects,
    mode,
    concurrency,
    signal: controller.signal,
  }).finally(() => {
    controllers.delete(operationId);
  });

  return {
    operationId,
    queuedProjects: selectedProjects.length,
    skippedSelfProjects: skippedSelfProjects.length,
  };
}

export function cancelQueuedAction(operationId) {
  const controller = controllers.get(operationId);
  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}
