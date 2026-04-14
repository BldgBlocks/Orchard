import { queueAction } from './actions.js';
import { loadSettings, validateWorkPath } from './config.js';
import { sanitizeSensitiveText } from './projects.js';
import { hasActiveOperations } from './state.js';

let timer = null;
let schedulerState = {
  enabled: false,
  intervalMinutes: 0,
  mode: 'smart',
  nextRunAt: null,
  lastTriggeredAt: null,
  lastMessage: 'Scheduler disabled.',
  lastError: null,
};

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function updateState(patch) {
  schedulerState = {
    ...schedulerState,
    ...patch,
  };
}

function scheduleNextRun(settings) {
  clearTimer();

  updateState({
    enabled: settings.scheduledSweepEnabled,
    intervalMinutes: settings.scheduledSweepIntervalMinutes,
    mode: settings.scheduledSweepMode,
  });

  if (!settings.scheduledSweepEnabled) {
    updateState({
      nextRunAt: null,
      lastMessage: 'Scheduler disabled.',
      lastError: null,
    });
    return getSchedulerStatus();
  }

  const delayMs = settings.scheduledSweepIntervalMinutes * 60 * 1000;
  const nextRunAt = new Date(Date.now() + delayMs).toISOString();

  updateState({
    nextRunAt,
    lastMessage: `Next scheduled sweep in ${settings.scheduledSweepIntervalMinutes} minute(s).`,
    lastError: null,
  });

  timer = setTimeout(() => {
    void triggerScheduledSweep();
  }, delayMs);
  timer.unref?.();

  return getSchedulerStatus();
}

async function triggerScheduledSweep() {
  const settings = await loadSettings();
  const startedAt = new Date().toISOString();

  if (!settings.scheduledSweepEnabled) {
    scheduleNextRun(settings);
    return;
  }

  if (hasActiveOperations()) {
    updateState({
      lastTriggeredAt: startedAt,
      lastMessage: 'Skipped scheduled sweep because another operation is still running.',
      lastError: null,
    });
    scheduleNextRun(settings);
    return;
  }

  const validation = await validateWorkPath(settings.workPath);
  if (!validation.ok) {
    updateState({
      lastTriggeredAt: startedAt,
      lastMessage: `Skipped scheduled sweep: ${validation.message}`,
      lastError: validation.message,
    });
    scheduleNextRun(settings);
    return;
  }

  try {
    const payload = await queueAction({
      settings,
      mode: settings.scheduledSweepMode,
      maxParallelJobs: settings.maxParallelJobs,
      triggeredBy: 'scheduler',
    });

    updateState({
      lastTriggeredAt: startedAt,
      lastMessage: `Queued scheduled ${settings.scheduledSweepMode} sweep for ${payload.queuedProjects} project(s).`,
      lastError: null,
    });
  } catch (error) {
    const duplicateMessage = error?.code === 'DUPLICATE_OPERATION'
      ? 'Skipped scheduled sweep because an equivalent operation is already queued or running.'
      : null;
    const safeMessage = sanitizeSensitiveText(error.message);

    updateState({
      lastTriggeredAt: startedAt,
      lastMessage: duplicateMessage || `Scheduled sweep failed to queue: ${safeMessage}`,
      lastError: duplicateMessage ? null : safeMessage,
    });
  }

  scheduleNextRun(settings);
}

export async function configureScheduler() {
  const settings = await loadSettings();
  return scheduleNextRun(settings);
}

export function getSchedulerStatus() {
  return { ...schedulerState };
}