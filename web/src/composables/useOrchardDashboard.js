import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useTheme } from 'vuetify';

import { api } from '../api';

export function useOrchardDashboard() {
  const theme = useTheme();

  const config = ref(null);
  const validation = ref(null);
  const modes = ref([]);
  const scheduler = ref(null);
  const health = ref({
    dockerAccessible: false,
    dockerMessage: '',
    dockerSocketMounted: false,
    validation: null,
  });
  const projects = ref([]);
  const activity = ref({
    activeOperations: [],
    recentHistory: [],
  });

  const loadingProjects = ref(false);
  const settingsOpen = ref(false);
  const savingSettings = ref(false);
  const search = ref('');
  const statusFilter = ref('all');
  const selectedProjectIds = ref([]);
  const snackbar = ref({
    show: false,
    text: '',
    color: 'primary',
  });

  const eventSource = ref(null);
  let refreshTimer = null;
  let reconnectTimer = null;

  const statusOptions = [
    { title: 'All states', value: 'all' },
    { title: 'Healthy', value: 'healthy' },
    { title: 'Running', value: 'running' },
    { title: 'Degraded', value: 'degraded' },
    { title: 'Stopped', value: 'stopped' },
    { title: 'Unknown', value: 'unknown' },
  ];

  function pluralize(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  function notify(text, color = 'primary') {
    snackbar.value = {
      show: true,
      text,
      color,
    };
  }

  const currentTheme = computed(() => theme.global.name.value);
  const themeToggleIcon = computed(() =>
    currentTheme.value === 'orchardNight' ? 'mdi-weather-sunny' : 'mdi-weather-night',
  );

  const actionDeck = computed(() => {
    const fallback = [
      {
        value: 'smart',
        label: 'Smart Sweep',
        description: 'Pull first and restart only when newer image layers were actually downloaded.',
        commandPreview: 'docker compose pull -> down -> up -d',
      },
      {
        value: 'force-update',
        label: 'Force Update',
        description: 'Always pull latest images, then cycle the stack.',
        commandPreview: 'docker compose pull -q -> down -> up -d',
      },
      {
        value: 'restart-only',
        label: 'Restart Only',
        description: 'Use the existing images and perform a plain restart.',
        commandPreview: 'docker compose down -> up -d',
      },
    ];

    const colorMap = {
      smart: 'primary',
      'force-update': 'secondary',
      'restart-only': 'warning',
    };

    return (modes.value.length ? modes.value : fallback).map((entry) => ({
      ...entry,
      color: colorMap[entry.value] || 'primary',
    }));
  });

  const busyProjectIds = computed(() => {
    const ids = new Set();

    for (const operation of activity.value.activeOperations || []) {
      for (const project of operation.projects || []) {
        if (['queued', 'running'].includes(project.status)) {
          ids.add(project.id);
        }
      }
    }

    return ids;
  });

  const actionsDisabled = computed(() =>
    !validation.value?.ok || !health.value?.dockerAccessible,
  );

  const dockerStatusText = computed(() => {
    if (health.value?.dockerAccessible) {
      return 'Docker access ready';
    }

    return health.value?.dockerMessage || 'Docker access unavailable';
  });

  const filteredProjects = computed(() => {
    const query = search.value.trim().toLowerCase();

    return projects.value.filter((project) => {
      const matchesQuery = !query
        || project.name.toLowerCase().includes(query)
        || project.relativePath.toLowerCase().includes(query)
        || (project.services || []).some((service) =>
          service.name.toLowerCase().includes(query),
        )
        || (project.composeDirectories || []).some((entry) =>
          entry.relativePath.toLowerCase().includes(query),
        );

      const matchesStatus = statusFilter.value === 'all' || project.status === statusFilter.value;
      return matchesQuery && matchesStatus;
    });
  });

  const selectableFilteredProjects = computed(() =>
    filteredProjects.value.filter((project) => !(config.value?.skipSelfProject && project.isSelfProject)),
  );

  const counts = computed(() => ({
    total: projects.value.length,
    healthy: projects.value.filter((project) => project.status === 'healthy').length,
    running: projects.value.filter((project) => project.status === 'running').length,
    degraded: projects.value.filter((project) => project.status === 'degraded').length,
    stopped: projects.value.filter((project) => project.status === 'stopped').length,
  }));

  const statCards = computed(() => [
    {
      label: 'Discovered Apps',
      value: counts.value.total,
      icon: 'mdi-view-grid-plus',
      color: 'primary',
    },
    {
      label: 'Healthy',
      value: counts.value.healthy,
      icon: 'mdi-heart-pulse',
      color: 'success',
    },
    {
      label: 'Needs Attention',
      value: counts.value.degraded,
      icon: 'mdi-alert-circle',
      color: 'warning',
    },
    {
      label: 'Stopped',
      value: counts.value.stopped,
      icon: 'mdi-stop-circle',
      color: 'grey-darken-1',
    },
  ]);

  const targetCount = computed(() => selectedProjectIds.value.length || projects.value.length);
  const targetLabel = computed(() =>
    selectedProjectIds.value.length
      ? `${pluralize(selectedProjectIds.value.length, 'selected app')}`
      : `all ${pluralize(projects.value.length, 'app')}`,
  );

  const schedulerSummary = computed(() => {
    if (!config.value?.scheduledSweepEnabled) {
      return 'Off';
    }

    return `Every ${config.value.scheduledSweepIntervalMinutes} min`;
  });

  const schedulerNextRunLabel = computed(() => {
    if (!scheduler.value?.nextRunAt) {
      return 'Not scheduled';
    }

    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(new Date(scheduler.value.nextRunAt));
  });

  function resetAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    const seconds = Number(config.value?.autoRefreshSeconds || 0);
    if (seconds > 0) {
      refreshTimer = setInterval(() => {
        fetchProjects(true).catch(() => {});
        fetchHealth().catch(() => {});
      }, seconds * 1000);
    }
  }

  async function fetchConfig() {
    const payload = await api.getConfig();
    config.value = payload.settings;
    validation.value = payload.validation;
    modes.value = payload.modes;
    scheduler.value = payload.scheduler;
    resetAutoRefresh();
  }

  async function fetchHealth() {
    health.value = await api.getHealth();
  }

  function getSavedTargetProjectIds(nextProjects = projects.value, nextSettings = config.value) {
    const savedTargetPaths = Array.isArray(nextSettings?.batchTargetPaths)
      ? nextSettings.batchTargetPaths
      : [];

    if (savedTargetPaths.length === 0) {
      return [];
    }

    return nextProjects
      .filter((project) => savedTargetPaths.includes(project.relativePath))
      .filter((project) => !(nextSettings?.skipSelfProject && project.isSelfProject))
      .map((project) => project.id);
  }

  function getBatchTargetPathsFromIds(projectIds) {
    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return [];
    }

    return projects.value
      .filter((project) => projectIds.includes(project.id))
      .filter((project) => !(config.value?.skipSelfProject && project.isSelfProject))
      .map((project) => project.relativePath)
      .sort((left, right) => left.localeCompare(right));
  }

  async function persistBatchTargets(projectIds) {
    try {
      const payload = await api.saveBatchTargets(getBatchTargetPathsFromIds(projectIds));
      config.value = {
        ...config.value,
        ...payload.settings,
      };
      selectedProjectIds.value = getSavedTargetProjectIds(projects.value, config.value);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function fetchProjects(quiet = false) {
    if (!quiet) {
      loadingProjects.value = true;
    }

    try {
      const payload = await api.getProjects();
      projects.value = payload.projects;
      selectedProjectIds.value = getSavedTargetProjectIds(payload.projects, config.value);
    } catch (error) {
      projects.value = [];
      notify(error.message, 'warning');
    } finally {
      loadingProjects.value = false;
    }
  }

  async function fetchActivity() {
    activity.value = await api.getActivity();
  }

  async function refreshAll(quiet = false) {
    await Promise.all([fetchConfig(), fetchHealth(), fetchActivity()]);
    await fetchProjects(quiet);
  }

  function connectEvents() {
    if (eventSource.value) {
      eventSource.value.close();
    }

    const source = new EventSource('/api/activity/stream');
    source.addEventListener('snapshot', (event) => {
      activity.value = JSON.parse(event.data);
    });

    source.onerror = () => {
      source.close();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      reconnectTimer = setTimeout(() => {
        connectEvents();
      }, 2000);
    };

    eventSource.value = source;
  }

  function toggleTheme() {
    theme.global.name.value = currentTheme.value === 'orchardNight'
      ? 'orchardDay'
      : 'orchardNight';

    localStorage.setItem('orchardTheme', theme.global.name.value);
  }

  function toggleSelection(projectId) {
    const nextSelection = selectedProjectIds.value.includes(projectId)
      ? selectedProjectIds.value.filter((entry) => entry !== projectId)
      : [...selectedProjectIds.value, projectId];

    selectedProjectIds.value = nextSelection;
    void persistBatchTargets(nextSelection);
  }

  function clearSelection() {
    selectedProjectIds.value = [];
    void persistBatchTargets([]);
  }

  function selectVisibleProjects() {
    const nextSelection = selectableFilteredProjects.value.map((project) => project.id);
    selectedProjectIds.value = nextSelection;
    void persistBatchTargets(nextSelection);
  }

  function isProjectBusy(projectId) {
    return busyProjectIds.value.has(projectId);
  }

  function formatRollbackHintsEntry(entry) {
    const lines = [];

    for (const project of entry.projects || []) {
      for (const hint of project.rollbackHints || []) {
        lines.push(`${project.name} | ${hint.targetLabel} | ${hint.service}\n  before: ${hint.beforeImage}\n  after:  ${hint.afterImage}`);
      }
    }

    return lines;
  }

  async function copyRollbackHints(entry) {
    const lines = formatRollbackHintsEntry(entry);
    if (lines.length === 0) {
      notify('No rollback hints were captured for this run.', 'warning');
      return;
    }

    const text = [`${entry.label}`, `Mode: ${entry.mode}`, '', ...lines].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      notify('Copied rollback hints.', 'success');
    } catch {
      notify('Clipboard access failed while copying rollback hints.', 'warning');
    }
  }

  async function runAction(mode, projectIds = []) {
    if (actionsDisabled.value) {
      notify('Mount the Docker socket and a valid work path before running actions.', 'warning');
      return;
    }

    try {
      const payload = await api.runAction({
        mode,
        projectIds,
        maxParallelJobs: config.value?.maxParallelJobs,
      });

      notify(
        payload.skippedSelfProjects
          ? `Queued ${pluralize(payload.queuedProjects, 'app')} for ${mode.replace('-', ' ')} and skipped ${pluralize(payload.skippedSelfProjects, 'self app')}.`
          : `Queued ${pluralize(payload.queuedProjects, 'app')} for ${mode.replace('-', ' ')}.`,
        'success',
      );
      await fetchActivity();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function runBatch(mode) {
    return runAction(mode, selectedProjectIds.value.slice());
  }

  function runProjectAction({ projectId, mode }) {
    return runAction(mode, [projectId]);
  }

  async function cancelOperation(operationId) {
    try {
      await api.cancelOperation(operationId);
      notify('Cancellation requested.', 'warning');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function saveSettings(nextSettings) {
    savingSettings.value = true;

    try {
      const payload = await api.saveConfig(nextSettings);
      config.value = payload.settings;
      validation.value = payload.validation;
      modes.value = payload.modes;
      scheduler.value = payload.scheduler;
      selectedProjectIds.value = getSavedTargetProjectIds(projects.value, payload.settings);
      settingsOpen.value = false;
      notify('Settings saved. Refreshing discovery.', 'success');
      await refreshAll(true);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      savingSettings.value = false;
    }
  }

  onMounted(async () => {
    const storedTheme = localStorage.getItem('orchardTheme');
    if (storedTheme) {
      theme.global.name.value = storedTheme;
    }

    connectEvents();
    await refreshAll();
  });

  onBeforeUnmount(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    eventSource.value?.close();
  });

  return {
    actionDeck,
    actionsDisabled,
    activity,
    cancelOperation,
    clearSelection,
    config,
    copyRollbackHints,
    dockerStatusText,
    filteredProjects,
    health,
    isProjectBusy,
    loadingProjects,
    modes,
    projects,
    refreshAll,
    runBatch,
    runProjectAction,
    saveSettings,
    savingSettings,
    scheduler,
    schedulerNextRunLabel,
    schedulerSummary,
    search,
    selectableFilteredProjects,
    selectedProjectIds,
    selectVisibleProjects,
    settingsOpen,
    snackbar,
    statCards,
    statusFilter,
    statusOptions,
    targetCount,
    targetLabel,
    themeToggleIcon,
    toggleSelection,
    toggleTheme,
    validation,
  };
}