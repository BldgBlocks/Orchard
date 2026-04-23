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

function normalizeScheduledTime(value, fallback = '21:00') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function resolveScheduledSweepIntervalDays(input, fallback) {
  if (input !== undefined && input !== null && input !== '') {
    return clamp(toNumber(input, fallback), 0.01, 365);
  }

  return fallback;
}

const envDefaultMode = VALID_MODES.includes(process.env.DEFAULT_MODE)
  ? process.env.DEFAULT_MODE
  : 'smart';

const envScheduledMode = VALID_MODES.includes(process.env.SCHEDULED_SWEEP_MODE)
  ? process.env.SCHEDULED_SWEEP_MODE
  : envDefaultMode;

const envScheduledSweepIntervalDays = clamp(
  toNumber(process.env.SCHEDULED_SWEEP_INTERVAL_DAYS, 14),
  0.01,
  365,
);

const envScheduledSweepTime = normalizeScheduledTime(process.env.SCHEDULED_SWEEP_TIME, '21:00');

function describeSettingsMigration(rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    return null;
  }

  if (!Object.hasOwn(rawSettings, 'scheduledSweepIntervalMinutes')) {
    return null;
  }

  return {
    applied: true,
    code: 'scheduled-sweep-safe-defaults',
    title: 'Scheduled sweep defaults were safely changed',
    message: 'Legacy minute-based scheduled sweep settings were migrated to the safer Orchard default of every 14 days at 9:00 PM.',
  };
}

function shouldRewriteSettings(rawSettings, nextSettings, migration) {
  if (migration?.applied) {
    return true;
  }

  return JSON.stringify(rawSettings) !== JSON.stringify(nextSettings);
}

export const defaultSettings = Object.freeze({
  workPath: path.resolve(process.env.WORK_PATH || process.cwd()),
  scanDepth: clamp(toNumber(process.env.SCAN_DEPTH, 3), 1, 8),
  maxParallelJobs: clamp(toNumber(process.env.MAX_PARALLEL_JOBS, 3), 1, 12),
  autoRefreshSeconds: clamp(toNumber(process.env.AUTO_REFRESH_SECONDS, 30), 0, 600),
  defaultMode: envDefaultMode,
  scheduledSweepEnabled: toBoolean(process.env.SCHEDULED_SWEEP_ENABLED, false),
  scheduledSweepIntervalDays: envScheduledSweepIntervalDays,
  scheduledSweepTime: envScheduledSweepTime,
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
  const scheduledSweepIntervalDays = resolveScheduledSweepIntervalDays(
    input.scheduledSweepIntervalDays,
    defaultSettings.scheduledSweepIntervalDays,
  );
  const scheduledSweepTime = normalizeScheduledTime(
    input.scheduledSweepTime,
    defaultSettings.scheduledSweepTime,
  );

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
    scheduledSweepIntervalDays,
    scheduledSweepTime,
    scheduledSweepMode,
    skipSelfProject: toBoolean(input.skipSelfProject, defaultSettings.skipSelfProject),
    batchTargetPaths: toStringArray(input.batchTargetPaths, defaultSettings.batchTargetPaths),
  };
}

export async function loadSettings() {
  const payload = await loadSettingsWithMetadata();
  return payload.settings;
}

export async function loadSettingsWithMetadata() {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const settings = sanitizeSettings(parsed);
    const settingsMigration = describeSettingsMigration(parsed);

    if (shouldRewriteSettings(parsed, settings, settingsMigration)) {
      await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
    }

    return {
      settings,
      settingsMigration,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to read persisted settings, falling back to defaults. ${sanitizePathText(error.message)}`);
    }

    const settings = sanitizeSettings(defaultSettings);
    await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
    return {
      settings,
      settingsMigration: null,
    };
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
