import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import YAML from 'yaml';

const COMPOSE_FILENAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const SELF_SERVICE_NAME = process.env.SELF_SERVICE_NAME || 'orchard';
const SELF_CONTAINER_NAME = process.env.SELF_CONTAINER_NAME || 'orchard';
const PASSTHROUGH_ENV_KEYS = new Set([
  'HOME',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NO_PROXY',
  'PATH',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TMPDIR',
  'USER',
  'http_proxy',
  'https_proxy',
  'no_proxy',
]);

function toShellPath(relativePath) {
  return relativePath && relativePath !== '.' ? `./${relativePath}` : './';
}

function buildDockerEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      PASSTHROUGH_ENV_KEYS.has(key)
        || key.startsWith('COMPOSE_')
        || key.startsWith('DOCKER_'),
    ),
  );
}

export function sanitizeSensitiveText(value = '') {
  return String(value)
    .replace(/(^|[\s"'`=:(\[])(\/(?:[^\s"'`)\]]+))/g, '$1[path]')
    .trim();
}

function createProjectId(relativePath) {
  return Buffer.from(relativePath || '.').toString('base64url');
}

function getParentRelativePath(relativePath) {
  if (!relativePath || relativePath === '.') {
    return null;
  }

  const parentPath = path.posix.dirname(relativePath);
  return parentPath === '.' ? null : parentPath;
}

function getAppRelativePath(relativePath, composeProjectPaths) {
  let appRelativePath = relativePath || '.';
  let candidate = getParentRelativePath(appRelativePath);

  while (candidate) {
    if (composeProjectPaths.has(candidate)) {
      appRelativePath = candidate;
    }
    candidate = getParentRelativePath(candidate);
  }

  return appRelativePath;
}

function commandText(args) {
  return `docker compose ${args.join(' ')}`;
}

function normalizeLines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectComposeFile(directoryPath) {
  for (const fileName of COMPOSE_FILENAMES) {
    if (await fileExists(path.join(directoryPath, fileName))) {
      return fileName;
    }
  }

  return null;
}

async function inspectComposeManifest(project) {
  try {
    const composeFilePath = path.join(project.absolutePath, project.composeFileName);
    const raw = await fs.readFile(composeFilePath, 'utf8');
    const parsed = YAML.parse(raw) || {};
    const services = parsed.services && typeof parsed.services === 'object'
      ? parsed.services
      : {};

    for (const [serviceName, serviceConfig] of Object.entries(services)) {
      if (serviceName === SELF_SERVICE_NAME) {
        return {
          isSelfProject: true,
          selfProjectReason: `Service name matches ${SELF_SERVICE_NAME}.`,
        };
      }

      if (serviceConfig?.container_name === SELF_CONTAINER_NAME) {
        return {
          isSelfProject: true,
          selfProjectReason: `container_name matches ${SELF_CONTAINER_NAME}.`,
        };
      }
    }
  } catch {
    // Ignore manifest parsing errors here; command-level inspection still proceeds.
  }

  return {
    isSelfProject: false,
    selfProjectReason: null,
  };
}

function toCommandResult(error) {
  if (error?.result) {
    return error.result;
  }

  return {
    ok: false,
    exitCode: 1,
    stdout: '',
    stderr: sanitizeSensitiveText(error?.message || 'Unexpected command failure.'),
    combinedOutput: sanitizeSensitiveText(error?.message || 'Unexpected command failure.'),
    commandText: 'docker compose',
  };
}

function parsePsOutput(output = '') {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to line-delimited JSON parsing.
  }

  return trimmed
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeContainer(rawContainer) {
  return {
    id: rawContainer.ID || rawContainer.id || '',
    name: rawContainer.Name || rawContainer.name || '',
    service: rawContainer.Service || rawContainer.service || '',
    state: String(rawContainer.State || rawContainer.state || '').toLowerCase(),
    health: String(rawContainer.Health || rawContainer.health || '').toLowerCase(),
    statusText: rawContainer.Status || rawContainer.status || rawContainer.State || 'unknown',
    exitCode: Number(rawContainer.ExitCode || rawContainer.exitCode || 0),
  };
}

function summarizeService(serviceName, containers = []) {
  const hasRunningReplica = containers.some((container) => container.state.includes('running'));
  const allReplicasRunning = containers.length > 0
    && containers.every((container) => container.state.includes('running'));
  const healthStates = containers.map((container) => container.health).filter(Boolean);

  let state = 'not-created';
  if (containers.length === 0) {
    state = 'not-created';
  } else if (allReplicasRunning) {
    state = 'running';
  } else if (hasRunningReplica) {
    state = 'mixed';
  } else if (containers.some((container) => container.state.includes('restart'))) {
    state = 'restarting';
  } else if (containers.some((container) => container.state.includes('exit') || container.state.includes('dead'))) {
    state = 'stopped';
  } else {
    state = containers[0].state || 'unknown';
  }

  let health = 'none';
  if (healthStates.includes('unhealthy')) {
    health = 'unhealthy';
  } else if (healthStates.length > 0 && healthStates.every((entry) => entry === 'healthy')) {
    health = 'healthy';
  } else if (healthStates.length > 0) {
    health = 'starting';
  }

  return {
    name: serviceName,
    replicas: containers.length,
    state,
    health,
    statusText: containers.map((container) => container.statusText).filter(Boolean).join(' | '),
  };
}

function deriveProjectStatus(services) {
  if (!services.length) {
    return 'unknown';
  }

  const allRunning = services.every((service) => service.state === 'running');
  const anyRunning = services.some((service) => service.state === 'running' || service.state === 'mixed');
  const anyUnhealthy = services.some((service) => service.health === 'unhealthy' || service.state === 'restarting');
  const allHealthyChecks = services
    .filter((service) => service.health !== 'none')
    .every((service) => service.health === 'healthy');

  if (allRunning && !anyUnhealthy) {
    return allHealthyChecks ? 'healthy' : 'running';
  }

  if (anyRunning || anyUnhealthy) {
    return 'degraded';
  }

  return 'stopped';
}

function deriveAggregateStatus(statuses) {
  if (!statuses.length) {
    return 'unknown';
  }

  if (statuses.every((status) => status === 'healthy')) {
    return 'healthy';
  }

  if (statuses.every((status) => status === 'healthy' || status === 'running')) {
    return 'running';
  }

  if (statuses.some((status) => status === 'degraded')) {
    return 'degraded';
  }

  if (statuses.some((status) => status === 'running' || status === 'healthy')) {
    return 'degraded';
  }

  if (statuses.every((status) => status === 'stopped')) {
    return 'stopped';
  }

  return 'unknown';
}

function aggregateServices(projects) {
  const servicesByName = new Map();

  for (const project of projects) {
    for (const service of project.services || []) {
      const existing = servicesByName.get(service.name);
      if (!existing) {
        servicesByName.set(service.name, {
          name: service.name,
          replicas: service.replicas,
          state: service.state,
          health: service.health,
          statusText: service.statusText,
        });
        continue;
      }

      existing.replicas += service.replicas;
      existing.statusText = [existing.statusText, service.statusText].filter(Boolean).join(' | ');

      if (existing.health !== 'unhealthy' && service.health === 'unhealthy') {
        existing.health = 'unhealthy';
      } else if (existing.health !== 'unhealthy' && existing.health !== 'healthy' && service.health) {
        existing.health = service.health;
      }

      const statePriority = ['degraded', 'restarting', 'mixed', 'running', 'stopped', 'not-created', 'unknown'];
      const currentIndex = statePriority.indexOf(existing.state);
      const nextIndex = statePriority.indexOf(service.state);
      if (nextIndex !== -1 && (currentIndex === -1 || nextIndex < currentIndex)) {
        existing.state = service.state;
      }
    }
  }

  return Array.from(servicesByName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function aggregateApps(rootPath, projects) {
  const appsByPath = new Map();
  const composeProjectPaths = new Set(projects.map((project) => project.relativePath));

  for (const project of projects) {
    const appRelativePath = getAppRelativePath(project.relativePath, composeProjectPaths);
    if (!appsByPath.has(appRelativePath)) {
      const absolutePath = appRelativePath === '.' ? rootPath : path.join(rootPath, appRelativePath);
      appsByPath.set(appRelativePath, {
        id: createProjectId(`app:${appRelativePath}`),
        name: appRelativePath === '.' ? path.basename(rootPath) : path.basename(appRelativePath),
        relativePath: appRelativePath,
        absolutePath,
        composeDirectories: [],
      });
    }

    appsByPath.get(appRelativePath).composeDirectories.push(project);
  }

  return Array.from(appsByPath.values())
    .map((app) => {
      const composeDirectories = app.composeDirectories
        .slice()
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      const statuses = composeDirectories.map((entry) => entry.status);
      const composeFileNames = [...new Set(composeDirectories.map((entry) => entry.composeFileName))];
      const serviceCount = composeDirectories.reduce((sum, entry) => sum + entry.serviceCount, 0);
      const runningServices = composeDirectories.reduce((sum, entry) => sum + entry.runningServices, 0);
      const healthyServices = composeDirectories.reduce((sum, entry) => sum + entry.healthyServices, 0);
      const stoppedServices = composeDirectories.reduce((sum, entry) => sum + entry.stoppedServices, 0);
      const errors = composeDirectories.map((entry) => entry.error).filter(Boolean);
      const selfProject = composeDirectories.find((entry) => entry.isSelfProject);

      return {
        ...app,
        isSelfProject: Boolean(selfProject),
        selfProjectReason: selfProject?.selfProjectReason || null,
        composeDirectoryCount: composeDirectories.length,
        composeFileNames,
        serviceCount,
        runningServices,
        healthyServices,
        stoppedServices,
        status: deriveAggregateStatus(statuses),
        services: aggregateServices(composeDirectories),
        error: errors[0] || null,
        composeDirectories,
      };
    })
    .map((app, _index, allApps) => {
      const duplicateCount = allApps.filter((entry) => entry.name === app.name).length;
      return duplicateCount > 1
        ? {
            ...app,
            name: app.relativePath,
          }
        : app;
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

async function walkForProjects(rootPath, maxDepth) {
  const results = [];

  async function visit(currentPath, depth) {
    let entries;

    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const composeFileName = await detectComposeFile(currentPath);
    if (composeFileName) {
      const relativePath = path.relative(rootPath, currentPath) || '.';
      results.push({
        id: createProjectId(relativePath),
        name: path.basename(currentPath),
        relativePath,
        absolutePath: currentPath,
        composeFileName,
      });
    }

    if (depth >= maxDepth) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      await visit(path.join(currentPath, entry.name), depth + 1);
    }
  }

  await visit(rootPath, 0);
  return results;
}

export async function runComposeCommand(cwd, args, { signal, onOutput } = {}) {
  const resolvedCommandText = commandText(args);
  onOutput?.({ level: 'command', message: `$ ${resolvedCommandText}` });
  const dockerEnvironment = buildDockerEnvironment();

  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      cwd,
      env: dockerEnvironment,
      signal,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const stdoutInterface = readline.createInterface({ input: child.stdout });
    const stderrInterface = readline.createInterface({ input: child.stderr });

    stdoutInterface.on('line', (line) => {
      if (line.trim()) {
        onOutput?.({ level: 'stdout', message: line });
      }
    });

    stderrInterface.on('line', (line) => {
      if (line.trim()) {
        onOutput?.({ level: 'stderr', message: line });
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      stdoutInterface.close();
      stderrInterface.close();

      const combinedOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (exitCode === 0) {
        resolve({
          ok: true,
          exitCode,
          stdout,
          stderr,
          combinedOutput,
          commandText: resolvedCommandText,
        });
        return;
      }

      const error = new Error(`${resolvedCommandText} exited with code ${exitCode}`);
      error.result = {
        ok: false,
        exitCode: exitCode ?? 1,
        stdout: sanitizeSensitiveText(stdout),
        stderr: sanitizeSensitiveText(stderr),
        combinedOutput: sanitizeSensitiveText(combinedOutput),
        commandText: resolvedCommandText,
      };
      reject(error);
    });
  });
}

export async function getDockerRuntimeStatus() {
  return new Promise((resolve) => {
    const dockerEnvironment = buildDockerEnvironment();

    const child = spawn('docker', ['info', '--format', '{{json .ServerVersion}}'], {
      env: dockerEnvironment,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        ok: false,
        version: null,
        message: error.code === 'ENOENT'
          ? 'Docker CLI is not available inside the container.'
          : 'Docker API is not reachable from Orchard.',
      });
    });

    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({
          ok: true,
          version: stdout.trim().replace(/^"|"$/g, ''),
          message: 'Docker API reachable.',
        });
        return;
      }

      resolve({
        ok: false,
        version: null,
        message: 'Docker API is not reachable from Orchard.',
      });
    });
  });
}

export function hasImageUpdates(output = '') {
  const lowered = output.toLowerCase();
  if (!lowered.trim()) {
    return false;
  }

  return [
    'pull complete',
    'downloaded newer image',
    'status: downloaded newer image',
    'status: pulled newer image',
    'downloading',
    'extracting',
    'pulling fs layer',
    'digest: sha256',
  ].some((token) => lowered.includes(token));
}

async function inspectProject(project) {
  const manifestInfo = await inspectComposeManifest(project);
  const [servicesResult, psResult] = await Promise.all([
    runComposeCommand(project.absolutePath, ['config', '--services']).catch(toCommandResult),
    runComposeCommand(project.absolutePath, ['ps', '-a', '--format', 'json']).catch(toCommandResult),
  ]);

  const serviceNames = servicesResult.ok ? normalizeLines(servicesResult.stdout) : [];
  const containers = psResult.ok
    ? parsePsOutput(psResult.stdout || psResult.combinedOutput).map(normalizeContainer)
    : [];

  const containersByService = new Map();
  for (const container of containers) {
    const serviceName = container.service || container.name || 'service';
    if (!containersByService.has(serviceName)) {
      containersByService.set(serviceName, []);
    }

    containersByService.get(serviceName).push(container);
  }

  const resolvedServiceNames = serviceNames.length > 0
    ? serviceNames
    : Array.from(containersByService.keys());

  const services = resolvedServiceNames.map((serviceName) =>
    summarizeService(serviceName, containersByService.get(serviceName) || []),
  );

  const runningServices = services.filter((service) =>
    service.state === 'running' || service.state === 'mixed',
  ).length;
  const healthyServices = services.filter((service) => service.health === 'healthy').length;
  const status = deriveProjectStatus(services);
  const error = !servicesResult.ok && !psResult.ok
    ? sanitizeSensitiveText(psResult.combinedOutput || servicesResult.combinedOutput)
    : null;

  return {
    ...project,
    ...manifestInfo,
    serviceCount: resolvedServiceNames.length,
    runningServices,
    healthyServices,
    stoppedServices: Math.max(resolvedServiceNames.length - runningServices, 0),
    status,
    services,
    error,
  };
}

export async function discoverProjects(settings) {
  const rootPath = path.resolve(settings.workPath);
  const discoveredProjects = await walkForProjects(rootPath, settings.scanDepth);
  const enrichedProjects = await mapLimit(discoveredProjects, 4, inspectProject);

  return aggregateApps(rootPath, enrichedProjects);
}

export function sanitizeProjectsForClient(projects) {
  return projects.map((project) => {
    const { absolutePath: _absolutePath, composeDirectories, ...rest } = project;

    return {
      ...rest,
      shellPath: toShellPath(project.relativePath),
      composeDirectories: (composeDirectories || []).map(({ absolutePath: _composeAbsolutePath, ...entry }) => entry),
    };
  });
}

export async function discoverProjectsForClient(settings) {
  return sanitizeProjectsForClient(await discoverProjects(settings));
}
