import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { queueAction, cancelQueuedAction } from './actions.js';
import {
  describeModes,
  isSafeTargetPath,
  loadSettings,
  saveSettings,
  VALID_MODES,
  validateWorkPath,
} from './config.js';
import { discoverProjectsForClient, getDockerRuntimeStatus, sanitizeSensitiveText } from './projects.js';
import { configureScheduler, getSchedulerStatus } from './scheduler.js';
import { getActivitySnapshot, initState, subscribe } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistPath = path.resolve(__dirname, '../../web/dist');
const port = Number(process.env.PORT || 3000);
const ORCHARD_REQUEST_HEADER = 'x-orchard-request';

function respondWithError(response, error, statusCode = 500) {
  response.status(statusCode).json({
    message: sanitizeSensitiveText(error?.message || 'Unexpected server error.'),
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function buildConfigPayload() {
  const settings = await loadSettings();
  const validation = await validateWorkPath(settings.workPath);

  return {
    settings,
    validation,
    modes: describeModes(),
    scheduler: getSchedulerStatus(),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireOrchardRequest(request, response, next) {
  if (request.get(ORCHARD_REQUEST_HEADER) !== '1') {
    response.status(400).json({
      message: 'Missing Orchard request header.',
    });
    return;
  }

  next();
}

function requireJsonBody(request, response, next) {
  if (!request.is('application/json')) {
    response.status(415).json({
      message: 'Expected an application/json request body.',
    });
    return;
  }

  if (!isPlainObject(request.body)) {
    response.status(400).json({
      message: 'Expected a JSON object request body.',
    });
    return;
  }

  next();
}

const app = express();
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'");
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use((error, _request, response, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      message: 'Invalid JSON request body.',
    });
    return;
  }

  next(error);
});

app.get('/api/health', async (_request, response) => {
  try {
    const settings = await loadSettings();
    const validation = await validateWorkPath(settings.workPath);
    const dockerRuntime = await getDockerRuntimeStatus();

    response.json({
      appName: 'Orchard',
      dockerSocketMounted: await pathExists('/var/run/docker.sock'),
      dockerAccessible: dockerRuntime.ok,
      dockerMessage: dockerRuntime.message,
      validation,
      time: new Date().toISOString(),
    });
  } catch (error) {
    respondWithError(response, error);
  }
});

app.get('/api/config', async (_request, response) => {
  try {
    response.json(await buildConfigPayload());
  } catch (error) {
    respondWithError(response, error);
  }
});

app.put('/api/config', requireOrchardRequest, requireJsonBody, async (request, response) => {
  try {
    const settings = await saveSettings(request.body);
    const validation = await validateWorkPath(settings.workPath);
    const scheduler = await configureScheduler();

    response.json({
      settings,
      validation,
      modes: describeModes(),
      scheduler,
    });
  } catch (error) {
    respondWithError(response, error, 400);
  }
});

app.put('/api/config/targets', requireOrchardRequest, requireJsonBody, async (request, response) => {
  try {
    if ('batchTargetPaths' in request.body && !Array.isArray(request.body.batchTargetPaths)) {
      response.status(400).json({
        message: 'batchTargetPaths must be an array when provided.',
      });
      return;
    }

    if (Array.isArray(request.body.batchTargetPaths) && request.body.batchTargetPaths.some((entry) => !isSafeTargetPath(entry))) {
      response.status(400).json({
        message: 'batchTargetPaths may only contain safe relative app paths.',
      });
      return;
    }

    const settings = await saveSettings({
      batchTargetPaths: request.body?.batchTargetPaths,
    });

    response.json({
      settings,
    });
  } catch (error) {
    respondWithError(response, error, 400);
  }
});

app.get('/api/projects', async (_request, response) => {
  try {
    const settings = await loadSettings();
    const validation = await validateWorkPath(settings.workPath);

    if (!validation.ok) {
      response.status(400).json({
        message: validation.message,
        validation,
      });
      return;
    }

    response.json({
      generatedAt: new Date().toISOString(),
      projects: await discoverProjectsForClient(settings),
    });
  } catch (error) {
    respondWithError(response, error);
  }
});

app.get('/api/activity', (_request, response) => {
  response.json(getActivitySnapshot());
});

app.get('/api/activity/stream', (_request, response) => {
  subscribe(response);
});

app.post('/api/actions/run', requireOrchardRequest, requireJsonBody, async (request, response) => {
  try {
    const settings = await loadSettings();
    const validation = await validateWorkPath(settings.workPath);

    if (!validation.ok) {
      response.status(400).json({
        message: validation.message,
      });
      return;
    }

    if (typeof request.body.mode !== 'string') {
      response.status(400).json({
        message: 'A run mode is required.',
      });
      return;
    }

    if ('projectIds' in request.body && !Array.isArray(request.body.projectIds)) {
      response.status(400).json({
        message: 'projectIds must be an array when provided.',
      });
      return;
    }

    if ('maxParallelJobs' in request.body && !Number.isFinite(Number(request.body.maxParallelJobs))) {
      response.status(400).json({
        message: 'maxParallelJobs must be numeric when provided.',
      });
      return;
    }

    const requestedMode = request.body.mode;

    if (!VALID_MODES.includes(requestedMode)) {
      response.status(400).json({
        message: 'Invalid run mode requested.',
      });
      return;
    }

    const payload = await queueAction({
      settings,
      mode: requestedMode,
      projectIds: request.body?.projectIds,
      maxParallelJobs: request.body?.maxParallelJobs,
    });

    response.status(202).json(payload);
  } catch (error) {
    respondWithError(response, error, 400);
  }
});

app.post('/api/operations/:id/cancel', requireOrchardRequest, (request, response) => {
  const cancelled = cancelQueuedAction(request.params.id);
  if (!cancelled) {
    response.status(404).json({
      message: 'Operation not found or already finished.',
    });
    return;
  }

  response.status(202).json({
    message: 'Cancellation requested.',
  });
});

const webBuildExists = await pathExists(webDistPath);
if (webBuildExists) {
  app.use(express.static(webDistPath));

  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next();
      return;
    }

    response.sendFile(path.join(webDistPath, 'index.html'));
  });
}

await initState();
await configureScheduler();

app.listen(port, () => {
  console.log(`Orchard server listening on port ${port}`);
  if (!webBuildExists) {
    console.log('Web build missing. Run npm --prefix web install && npm --prefix web run build for the bundled UI.');
  }
});