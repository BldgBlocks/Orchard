<script setup>
import { reactive } from 'vue';

import StatusChip from './StatusChip.vue';

defineProps({
  activity: {
    type: Object,
    required: true,
  },
});

defineEmits(['cancel', 'copy-rollback']);

const selectedTabs = reactive({});
const expandedHistory = reactive({});
const logDialog = reactive({
  open: false,
  title: '',
  subtitle: '',
  logs: [],
});

function modeLabel(mode) {
  return {
    smart: 'Smart Sweep',
    'force-update': 'Force Update',
    'restart-only': 'Restart Only',
    'start-only': 'Start All',
    'stop-only': 'Stop All',
  }[mode] || mode;
}

function formatDateTime(value) {
  if (!value) {
    return 'Pending';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function progress(operation) {
  if (!operation.total) {
    return 0;
  }

  return Math.round((operation.completed / operation.total) * 100);
}

function sourceTabs(operation) {
  const sources = new Set(
    (operation.logs || [])
      .map((entry) => entry.source)
      .filter((source) => source && source !== 'system'),
  );

  for (const app of operation.projects || []) {
    if (app?.name) {
      sources.add(app.name);
    }
  }

  return ['overview', ...Array.from(sources).sort((left, right) => left.localeCompare(right))];
}

function currentTab(operation) {
  if (!selectedTabs[operation.id]) {
    selectedTabs[operation.id] = 'overview';
  }

  return selectedTabs[operation.id];
}

function setCurrentTab(operationId, value) {
  selectedTabs[operationId] = value;
}

function visibleLogs(operation, tab) {
  if (tab === 'overview') {
    return (operation.logs || []).filter((entry) => entry.source === 'system').slice(-8);
  }

  return (operation.logs || []).filter((entry) => entry.source === tab).slice(-24);
}

function appSummary(operation, appName) {
  return (operation.projects || []).find((project) => project.name === appName) || null;
}

function rollbackHints(project) {
  return project?.rollbackHints || [];
}

function totalRollbackHints(entry) {
  return (entry.projects || []).reduce((sum, project) => sum + rollbackHints(project).length, 0);
}

function operationProgressText(entry) {
  if (entry.mode === 'start-only' || entry.mode === 'stop-only') {
    return `${entry.completed}/${entry.total} apps complete`;
  }

  return `${entry.completed}/${entry.total} processed, ${entry.updated ?? 0} updated`;
}

function updatedProjects(entry) {
  if (!entry || entry.mode === 'start-only' || entry.mode === 'stop-only') {
    return [];
  }

  return (entry.projects || []).filter((project) => project.status === 'completed');
}

function hasUpdatedProjects(entry) {
  return updatedProjects(entry).length > 0;
}

function toggleHistoryExpanded(entryId) {
  expandedHistory[entryId] = !expandedHistory[entryId];
}

function historyExpanded(entryId) {
  return Boolean(expandedHistory[entryId]);
}

function openLogs(entry) {
  logDialog.open = true;
  logDialog.title = entry.label;
  logDialog.subtitle = `${modeLabel(entry.mode)} · ${operationProgressText(entry)}`;
  logDialog.logs = entry.logs || [];
}

function closeLogs() {
  logDialog.open = false;
}
</script>

<template>
  <v-card class="activity-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Live Feed</p>
        <h2>Runbook</h2>
      </div>
      <v-chip color="secondary" variant="tonal">
        {{ activity.activeOperations.length }} active
      </v-chip>
    </div>

    <div v-if="activity.activeOperations.length" class="operation-list">
      <v-card v-for="operation in activity.activeOperations" :key="operation.id" class="operation-card">
        <div class="d-flex align-start justify-space-between ga-4 flex-wrap">
          <div>
            <div class="d-flex align-center ga-2 flex-wrap">
              <StatusChip :status="operation.status" />
              <strong>{{ operation.label }}</strong>
            </div>
            <p class="text-medium-emphasis mt-2 mb-0">
              {{ modeLabel(operation.mode) }} · {{ operationProgressText(operation) }} · started {{ formatDateTime(operation.startedAt) }}
            </p>
            <p v-if="totalRollbackHints(operation)" class="text-medium-emphasis mt-1 mb-0">
              Rollback hints captured for {{ totalRollbackHints(operation) }} service{{ totalRollbackHints(operation) === 1 ? '' : 's' }}.
            </p>
          </div>

          <div class="d-flex ga-2 flex-wrap justify-end">
            <v-btn
              size="small"
              title="Open the persisted log lines for this run in a larger dialog."
              variant="text"
              @click="openLogs(operation)"
            >
              Show logs
            </v-btn>
            <v-btn
              v-if="totalRollbackHints(operation)"
              color="brown"
              size="small"
              title="Copy the captured before and after image references for this run."
              variant="text"
              @click="$emit('copy-rollback', operation)"
            >
              Copy rollback hints
            </v-btn>
            <v-btn
              color="error"
              size="small"
              title="Request cancellation for this active operation. Already running commands may finish their current step first."
              variant="text"
              @click="$emit('cancel', operation.id)"
            >
              Cancel
            </v-btn>
          </div>
        </div>

        <v-progress-linear class="mt-4" color="primary" :model-value="progress(operation)" rounded />

        <v-tabs
          class="mt-4"
          color="primary"
          density="comfortable"
          :model-value="currentTab(operation)"
          @update:model-value="setCurrentTab(operation.id, $event)"
        >
          <v-tab value="overview">Overview</v-tab>
          <v-tab
            v-for="source in sourceTabs(operation).filter((tab) => tab !== 'overview')"
            :key="source"
            :value="source"
          >
            {{ source }}
          </v-tab>
        </v-tabs>

        <v-window :model-value="currentTab(operation)" class="mt-3">
          <v-window-item value="overview">
            <div class="summary-grid">
              <div v-for="project in operation.projects" :key="project.id" class="summary-row">
                <div class="summary-topline">
                  <strong>{{ project.name }}</strong>
                  <StatusChip :status="project.status" />
                </div>
                <p class="summary-text">{{ project.summary }}</p>
                <div v-if="rollbackHints(project).length" class="rollback-list">
                  <div v-for="hint in rollbackHints(project).slice(0, 3)" :key="`${hint.targetLabel}-${hint.service}`" class="rollback-row">
                    <strong>{{ hint.service }}</strong>
                    <span class="rollback-arrow">{{ hint.beforeImage }} -> {{ hint.afterImage }}</span>
                  </div>
                  <p v-if="rollbackHints(project).length > 3" class="rollback-more">
                    +{{ rollbackHints(project).length - 3 }} more captured rollback hint{{ rollbackHints(project).length - 3 === 1 ? '' : 's' }}.
                  </p>
                </div>
              </div>
            </div>

            <div class="activity-log mt-3">
              <div v-if="visibleLogs(operation, 'overview').length === 0" class="empty-log-note">
                System-level run messages will appear here. Use an app tab to follow one app without competing log output.
              </div>
              <div v-for="entry in visibleLogs(operation, 'overview')" :key="entry.id" class="log-line">
                <span class="log-time font-mono">{{ formatDateTime(entry.timestamp) }}</span>
                <strong class="log-source">{{ entry.source }}</strong>
                <span class="log-message">{{ entry.message }}</span>
              </div>
            </div>
          </v-window-item>

          <v-window-item
            v-for="source in sourceTabs(operation).filter((tab) => tab !== 'overview')"
            :key="source"
            :value="source"
          >
            <div class="summary-grid single-summary">
              <div class="summary-row">
                <div class="summary-topline">
                  <strong>{{ source }}</strong>
                  <StatusChip :status="appSummary(operation, source)?.status || 'unknown'" />
                </div>
                <p class="summary-text">{{ appSummary(operation, source)?.summary || 'Waiting for activity.' }}</p>
                <div v-if="rollbackHints(appSummary(operation, source)).length" class="rollback-list">
                  <div v-for="hint in rollbackHints(appSummary(operation, source)).slice(0, 4)" :key="`${hint.targetLabel}-${hint.service}`" class="rollback-row">
                    <strong>{{ hint.service }}</strong>
                    <span class="rollback-arrow">{{ hint.beforeImage }} -> {{ hint.afterImage }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="activity-log mt-3">
              <div v-if="visibleLogs(operation, source).length === 0" class="empty-log-note">
                No log lines for this app yet.
              </div>
              <div v-for="entry in visibleLogs(operation, source)" :key="entry.id" class="log-line">
                <span class="log-time font-mono">{{ formatDateTime(entry.timestamp) }}</span>
                <strong class="log-source">{{ entry.source }}</strong>
                <span class="log-message">{{ entry.message }}</span>
              </div>
            </div>
          </v-window-item>
        </v-window>
      </v-card>
    </div>

    <div v-else class="empty-note">
      No active work. Batch runs and per-app actions stream here in real time.
    </div>

    <v-divider class="my-6" />

    <div class="panel-heading">
      <div>
        <p class="eyebrow">History</p>
        <h2>Recent Runs</h2>
      </div>
    </div>

    <div v-if="activity.recentHistory.length" class="history-list">
      <div v-for="entry in activity.recentHistory" :key="entry.id" class="history-row">
        <div class="history-main">
          <div class="history-status">
            <StatusChip :status="entry.status" />
          </div>

          <div class="history-copy">
            <strong>{{ entry.label }}</strong>
            <p class="history-subtitle">
              {{ modeLabel(entry.mode) }} · {{ operationProgressText(entry) }} · {{ entry.failed }} failed · finished {{ formatDateTime(entry.finishedAt || entry.startedAt) }}
            </p>
          </div>

          <div class="history-actions">
            <v-btn
              size="small"
              title="Open the persisted log lines for this completed run in a larger dialog."
              variant="text"
              @click="openLogs(entry)"
            >
              Show logs
            </v-btn>
            <v-btn
              v-if="hasUpdatedProjects(entry)"
              size="small"
              title="Show which apps were updated in this run."
              variant="text"
              @click="toggleHistoryExpanded(entry.id)"
            >
              {{ historyExpanded(entry.id) ? 'Hide updated apps' : `Show ${updatedProjects(entry).length} updated app${updatedProjects(entry).length === 1 ? '' : 's'}` }}
            </v-btn>
            <v-btn
              v-if="totalRollbackHints(entry)"
              color="brown"
              size="small"
              title="Copy the captured before and after image references for this completed run."
              variant="text"
              @click="$emit('copy-rollback', entry)"
            >
              Copy rollback hints
            </v-btn>
          </div>
        </div>

        <v-expand-transition>
          <div v-if="historyExpanded(entry.id) && hasUpdatedProjects(entry)" class="history-expanded">
            <div
              v-for="project in updatedProjects(entry)"
              :key="project.id"
              class="history-project"
            >
              <div class="history-project-topline">
                <strong>{{ project.name }}</strong>
                <StatusChip :status="project.status" />
              </div>
              <p>{{ project.summary }}</p>
            </div>
          </div>
        </v-expand-transition>
      </div>
    </div>

    <v-dialog v-model="logDialog.open" max-width="920">
      <v-card class="log-dialog-card">
        <div class="log-dialog-header">
          <div>
            <p class="eyebrow">Run Logs</p>
            <h3>{{ logDialog.title }}</h3>
            <p class="log-dialog-subtitle">{{ logDialog.subtitle }}</p>
          </div>
          <v-btn
            icon="mdi-close"
            title="Close the log viewer."
            variant="text"
            @click="closeLogs"
          />
        </div>

        <div v-if="logDialog.logs.length" class="log-dialog-body">
          <div v-for="entry in logDialog.logs" :key="entry.id" class="modal-log-line">
            <span class="modal-log-time font-mono">{{ formatDateTime(entry.timestamp) }}</span>
            <strong class="modal-log-source">{{ entry.source }}</strong>
            <span class="modal-log-message">{{ entry.message }}</span>
          </div>
        </div>

        <div v-else class="empty-note">
          No persisted log lines were captured for this run.
        </div>

        <div class="log-dialog-footer">
          <v-btn variant="text" @click="closeLogs">Close</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <div v-if="!activity.recentHistory.length" class="empty-note">
      Completed runs are persisted to the app data volume so the UI stays useful after restarts.
    </div>
  </v-card>
</template>

<style scoped>
.activity-panel {
  border: 1px solid rgba(148, 163, 184, 0.18);
  padding: 1.25rem;
}

.panel-heading {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.panel-heading h2 {
  margin: 0.15rem 0 0;
}

.operation-list {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.operation-card {
  border: 1px solid rgba(148, 163, 184, 0.18);
  padding: 1rem;
}

.project-mini-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 1rem;
}

.summary-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.single-summary {
  grid-template-columns: 1fr;
}

.summary-row {
  background: rgba(15, 23, 42, 0.05);
  border-radius: 16px;
  padding: 0.85rem 0.95rem;
}

.summary-topline {
  align-items: center;
  display: flex;
  gap: 0.6rem;
  justify-content: space-between;
}

.summary-text {
  margin: 0.55rem 0 0;
  opacity: 0.8;
}

.rollback-list {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.75rem;
}

.rollback-row {
  display: grid;
  gap: 0.2rem;
}

.rollback-arrow {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.82rem;
  opacity: 0.8;
  overflow-wrap: anywhere;
}

.rollback-more {
  margin: 0.2rem 0 0;
  opacity: 0.72;
}

.activity-log {
  background: rgba(15, 23, 42, 0.06);
  border-radius: 18px;
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
  min-height: 15rem;
  max-height: 15rem;
  overflow-y: auto;
  padding: 0.9rem;
}

.log-line {
  display: grid;
  gap: 0.35rem 0.8rem;
  grid-template-columns: auto auto minmax(0, 1fr);
  line-height: 1.35;
}

.log-time,
.log-source {
  white-space: nowrap;
}

.log-message {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.empty-log-note {
  opacity: 0.72;
  padding: 0.25rem 0;
}

.empty-note {
  opacity: 0.78;
  padding: 1rem 0 0.25rem;
}

.history-list {
  display: grid;
  gap: 0.9rem;
}

.history-row {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 20px;
  padding: 0.95rem 1rem;
}

.history-main {
  align-items: flex-start;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.history-status {
  padding-top: 0.1rem;
}

.history-copy {
  min-width: 0;
}

.history-subtitle {
  margin: 0.35rem 0 0;
  opacity: 0.76;
}

.history-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: flex-end;
}

.history-expanded {
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  display: grid;
  gap: 0.7rem;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
}

.history-project {
  background: rgba(15, 23, 42, 0.05);
  border-radius: 16px;
  padding: 0.8rem 0.9rem;
}

.history-project p {
  margin: 0.45rem 0 0;
  opacity: 0.8;
}

.history-project-topline {
  align-items: center;
  display: flex;
  gap: 0.6rem;
  justify-content: space-between;
}

.log-dialog-card {
  backdrop-filter: blur(20px);
  background: var(--orchard-panel-bg);
  border: 1px solid var(--orchard-panel-border);
  box-shadow: var(--orchard-panel-shadow);
  padding: 1rem;
}

.log-dialog-header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.log-dialog-header h3 {
  margin: 0.15rem 0 0;
}

.log-dialog-subtitle {
  margin: 0.4rem 0 0;
  opacity: 0.76;
}

.log-dialog-body {
  background: rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  display: grid;
  gap: 0.55rem;
  margin-top: 1rem;
  max-height: min(65vh, 40rem);
  overflow-y: auto;
  padding: 1rem;
}

.modal-log-line {
  display: grid;
  gap: 0.35rem 0.8rem;
  grid-template-columns: auto auto minmax(0, 1fr);
  line-height: 1.4;
}

.modal-log-time,
.modal-log-source {
  white-space: nowrap;
}

.modal-log-message {
  overflow-wrap: anywhere;
  user-select: text;
  white-space: pre-wrap;
}

.log-dialog-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

@media (max-width: 900px) {
  .summary-grid,
  .log-line,
  .modal-log-line,
  .history-main {
    grid-template-columns: 1fr;
  }

  .history-actions {
    justify-content: flex-start;
  }
}
</style>
