import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
export const VALID_MODES = ['smart', 'force-update', 'restart-only', 'start-only', 'stop-only'];

function sanitizePathText(value = '') {
  return String(value)
    .replace(/(^|[\s"'`=:(\[])(\/(?:[^\s"'`)\]]+))/g, '$1[path]')
    .trim();
}

export function isSafeTargetPath(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith('/')) {
    return false;
  }

  return !normalized.split('/').some((segment) => segment === '..');
}

function toStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return [...new Set(
    value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(isSafeTargetPath)
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const envDefaultMode = VALID_MODES.includes(process.env.DEFAULT_MODE)
  ? process.env.DEFAULT_MODE
  : 'smart';

const envScheduledMode = VALID_MODES.includes(process.env.SCHEDULED_SWEEP_MODE)
  ? process.env.SCHEDULED_SWEEP_MODE
  : envDefaultMode;

export const defaultSettings = Object.freeze({
  workPath: path.resolve(process.env.WORK_PATH || process.cwd()),
  scanDepth: clamp(toNumber(process.env.SCAN_DEPTH, 3), 1, 8),
  maxParallelJobs: clamp(toNumber(process.env.MAX_PARALLEL_JOBS, 3), 1, 12),
  autoRefreshSeconds: clamp(toNumber(process.env.AUTO_REFRESH_SECONDS, 30), 0, 600),
  defaultMode: envDefaultMode,
  scheduledSweepEnabled: toBoolean(process.env.SCHEDULED_SWEEP_ENABLED, false),
  scheduledSweepIntervalMinutes: clamp(
    toNumber(process.env.SCHEDULED_SWEEP_INTERVAL_MINUTES, 360),
    1,
    10080,
  ),
  scheduledSweepMode: envScheduledMode,
  skipSelfProject: toBoolean(process.env.SKIP_SELF_PROJECT, true),
  batchTargetPaths: [],
});

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function sanitizeSettings(input = {}) {
  const nextMode = VALID_MODES.includes(input.defaultMode)
    ? input.defaultMode
    : defaultSettings.defaultMode;
  const scheduledSweepMode = VALID_MODES.includes(input.scheduledSweepMode)
    ? input.scheduledSweepMode
    : defaultSettings.scheduledSweepMode;

  return {
    workPath: path.resolve(
      typeof input.workPath === 'string' && input.workPath.trim()
        ? input.workPath.trim()
        : defaultSettings.workPath,
    ),
    scanDepth: clamp(toNumber(input.scanDepth, defaultSettings.scanDepth), 1, 8),
    maxParallelJobs: clamp(
      toNumber(input.maxParallelJobs, defaultSettings.maxParallelJobs),
      1,
      12,
    ),
    autoRefreshSeconds: clamp(
      toNumber(input.autoRefreshSeconds, defaultSettings.autoRefreshSeconds),
      0,
      600,
    ),
    defaultMode: nextMode,
    scheduledSweepEnabled: toBoolean(
      input.scheduledSweepEnabled,
      defaultSettings.scheduledSweepEnabled,
    ),
    scheduledSweepIntervalMinutes: clamp(
      toNumber(
        input.scheduledSweepIntervalMinutes,
        defaultSettings.scheduledSweepIntervalMinutes,
      ),
      1,
      10080,
    ),
    scheduledSweepMode,
    skipSelfProject: toBoolean(input.skipSelfProject, defaultSettings.skipSelfProject),
    batchTargetPaths: toStringArray(input.batchTargetPaths, defaultSettings.batchTargetPaths),
  };
}

export async function loadSettings() {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    return sanitizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to read persisted settings, falling back to defaults. ${sanitizePathText(error.message)}`);
    }

    const settings = sanitizeSettings(defaultSettings);
    await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
    return settings;
  }
}

export async function saveSettings(candidate) {
  const current = await loadSettings();
  const next = sanitizeSettings({ ...current, ...candidate });

  await ensureDataDir();
  await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);

  return next;
}

export async function validateWorkPath(workPath) {
  const resolvedPath = path.resolve(workPath);

  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        message: 'Path exists but is not a directory.',
      };
    }

    return {
      ok: true,
      message: 'Ready to scan compose folders.',
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        ok: false,
        message: 'Path does not exist inside the container mount.',
      };
    }

    return {
      ok: false,
      message: sanitizePathText(error.message),
    };
  }
}

export function describeModes() {
  return [
    {
      value: 'smart',
      label: 'Smart Sweep',
      description: 'Runs docker compose pull first, then restarts only if a newer image was actually downloaded.',
      commandPreview: 'docker compose pull -> docker compose down -> docker compose up -d (only when updates land)',
    },
    {
      value: 'force-update',
      label: 'Force Update',
      description: 'Always pulls images, then cycles the compose stack.',
      commandPreview: 'docker compose pull -q -> docker compose down -> docker compose up -d',
    },
    {
      value: 'restart-only',
      label: 'Restart Only',
      description: 'Leaves images untouched and performs a plain down and up cycle.',
      commandPreview: 'docker compose down -> docker compose up -d',
    },
  ];
}
