import { queueAction } from './actions.js';
import { loadSettings, validateWorkPath } from './config.js';
import { sanitizeSensitiveText } from './projects.js';
import { hasActiveOperations } from './state.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let timer = null;
let schedulerState = {
  enabled: false,
  intervalDays: 0,
  timeOfDay: '21:00',
  mode: 'smart',
  nextRunAt: null,
  lastTriggeredAt: null,
  lastMessage: 'Scheduler disabled.',
  lastError: null,
};

function parseScheduledTime(value = '21:00') {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return { hours: 21, minutes: 0 };
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function formatIntervalDays(value) {
  const rounded = Number(value);
  if (!Number.isFinite(rounded)) {
    return '14 days';
  }

  if (Math.abs(rounded - Math.round(rounded)) < 0.000001) {
    const wholeDays = Math.round(rounded);
    return `${wholeDays} day${wholeDays === 1 ? '' : 's'}`;
  }

  return `${rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d*[1-9])0+$/, '$1')} days`;
}

function computeNextRunAt(settings, now = new Date()) {
  const intervalDays = Number(settings.scheduledSweepIntervalDays) || 14;
  const delayMs = intervalDays * DAY_MS;

  if (intervalDays < 1) {
    return new Date(now.getTime() + delayMs);
  }

  const earliestRun = new Date(now.getTime() + delayMs);
  const { hours, minutes } = parseScheduledTime(settings.scheduledSweepTime);
  const candidate = new Date(earliestRun);
  candidate.setHours(hours, minutes, 0, 0);

  if (candidate.getTime() < earliestRun.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

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
    intervalDays: settings.scheduledSweepIntervalDays,
    timeOfDay: settings.scheduledSweepTime,
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

  const nextRunDate = computeNextRunAt(settings);
  const delayMs = Math.max(0, nextRunDate.getTime() - Date.now());
  const nextRunAt = nextRunDate.toISOString();

  updateState({
    nextRunAt,
    lastMessage: settings.scheduledSweepIntervalDays < 1
      ? `Next scheduled sweep in ${formatIntervalDays(settings.scheduledSweepIntervalDays)}.`
      : `Next scheduled sweep in ${formatIntervalDays(settings.scheduledSweepIntervalDays)} at ${settings.scheduledSweepTime}.`,
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