<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import ActivityPanel from './components/ActivityPanel.vue';
import BatchControls from './components/BatchControls.vue';
import DashboardHero from './components/DashboardHero.vue';
import DashboardStats from './components/DashboardStats.vue';
import DashboardToolbar from './components/DashboardToolbar.vue';
import ProjectCard from './components/ProjectCard.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { useOrchardDashboard } from './composables/useOrchardDashboard';

const {
  actionDeck,
  actionsDisabled,
  activity,
  cancelOperation,
  clearSelection,
  config,
  copyRollbackHints,
  copyShellCommand,
  copySelfUpdateCommand,
  dockerStatusText,
  filteredProjects,
  health,
  isProjectBusy,
  loadingProjects,
  modes,
  refreshAll,
  runBatch,
  runProjectAction,
  saveSettings,
  savingSettings,
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
} = useOrchardDashboard();

const projectGrid = ref(null);
const projectCellElements = new Map();
let masonryObserver = null;
let masonryFrame = 0;

function applyMasonrySpan(cell) {
  const gridElement = projectGrid.value;
  if (!gridElement || !cell) {
    return;
  }

  const gridStyles = window.getComputedStyle(gridElement);
  const rowGap = Number.parseFloat(gridStyles.rowGap || '0');
  const autoRowHeight = Number.parseFloat(gridStyles.gridAutoRows || '1');
  const contentHeight = cell.getBoundingClientRect().height;
  const span = Math.max(1, Math.ceil((contentHeight + rowGap) / (autoRowHeight + rowGap)));

  cell.style.gridRowEnd = `span ${span}`;
}

function scheduleMasonryLayout() {
  if (masonryFrame) {
    cancelAnimationFrame(masonryFrame);
  }

  masonryFrame = requestAnimationFrame(() => {
    masonryFrame = 0;
    projectCellElements.forEach((cell) => applyMasonrySpan(cell));
  });
}

function setProjectCellRef(projectId, element) {
  const previousElement = projectCellElements.get(projectId);

  if (previousElement && masonryObserver) {
    masonryObserver.unobserve(previousElement);
  }

  if (!element) {
    projectCellElements.delete(projectId);
    return;
  }

  projectCellElements.set(projectId, element);

  if (masonryObserver) {
    masonryObserver.observe(element);
  }

  scheduleMasonryLayout();
}

onMounted(() => {
  masonryObserver = new ResizeObserver(() => {
    scheduleMasonryLayout();
  });

  if (projectGrid.value) {
    masonryObserver.observe(projectGrid.value);
  }

  window.addEventListener('resize', scheduleMasonryLayout);
  void nextTick().then(() => {
    scheduleMasonryLayout();
  });
});

onBeforeUnmount(() => {
  if (masonryFrame) {
    cancelAnimationFrame(masonryFrame);
  }

  masonryObserver?.disconnect();
  window.removeEventListener('resize', scheduleMasonryLayout);
});

watch(filteredProjects, async () => {
  await nextTick();
  scheduleMasonryLayout();
}, { flush: 'post' });
</script>

<template>
  <v-app>
    <div class="app-shell">
      <v-container class="py-6">
        <DashboardHero
          :config="config"
          :docker-status-text="dockerStatusText"
          :health="health"
          :loading-projects="loadingProjects"
          :scheduler-next-run-label="schedulerNextRunLabel"
          :scheduler-summary="schedulerSummary"
          :theme-toggle-icon="themeToggleIcon"
          :validation="validation"
          @open-settings="settingsOpen = true"
          @refresh="refreshAll()"
          @toggle-theme="toggleTheme"
        />

        <DashboardStats :stat-cards="statCards" />

        <BatchControls
          :action-deck="actionDeck"
          :actions-disabled="actionsDisabled"
          :target-count="targetCount"
          :target-label="targetLabel"
          @run-batch="runBatch"
        >
          <template #side-panel>
            <ActivityPanel :activity="activity" @cancel="cancelOperation" @copy-rollback="copyRollbackHints" />
          </template>
        </BatchControls>

        <DashboardToolbar
          v-model:search="search"
          v-model:status-filter="statusFilter"
          :has-selection="selectedProjectIds.length > 0"
          :has-visible-projects="selectableFilteredProjects.length > 0"
          :status-options="statusOptions"
          @clear-selection="clearSelection"
          @select-visible="selectVisibleProjects"
        />

        <v-alert v-if="validation && !validation.ok" class="mt-4" type="warning" variant="tonal">
          The current work path is not valid inside the container. Mount the correct host directory and update settings.
        </v-alert>

        <div ref="projectGrid" class="project-grid mt-4">
          <div
            v-for="project in filteredProjects"
            :key="project.id"
            :ref="(element) => setProjectCellRef(project.id, element)"
            class="project-cell"
          >
            <ProjectCard
              :busy="isProjectBusy(project.id)"
              :disabled="Boolean(config?.skipSelfProject && project.isSelfProject)"
              :project="project"
              :selected="selectedProjectIds.includes(project.id)"
              @action="runProjectAction"
              @copy-shell="copyShellCommand"
              @copy-self-update="copySelfUpdateCommand"
              @toggle-select="toggleSelection"
            />
          </div>
        </div>

        <v-card v-if="!filteredProjects.length" class="empty-card mt-2">
          <v-icon icon="mdi-folder-search-outline" size="42" />
          <h3>No apps match the current filters.</h3>
          <p>Change the work path, widen the search depth, or clear the search query.</p>
        </v-card>
      </v-container>

      <SettingsDialog
        v-model="settingsOpen"
        :modes="modes"
        :saving="savingSettings"
        :settings="config"
        :validation="validation"
        @save="saveSettings"
      />

      <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="bottom right" timeout="3600">
        {{ snackbar.text }}
      </v-snackbar>
    </div>
  </v-app>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  padding-bottom: 3rem;
}

.project-grid {
  display: grid;
  gap: 0.9rem;
  grid-auto-rows: 8px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  align-items: start;
}

.project-cell {
  align-self: start;
  min-width: 0;
}

.empty-card {
  align-items: center;
  backdrop-filter: blur(20px);
  background: var(--orchard-panel-bg);
  border: 1px solid var(--orchard-panel-border);
  border-radius: 28px;
  box-shadow: var(--orchard-panel-shadow);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  justify-content: center;
  min-height: 14rem;
  padding: 1.25rem;
  text-align: center;
}

.empty-card h3,
.empty-card p {
  margin: 0;
}

@media (max-width: 1260px) {
  .project-grid {
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  }
}

@media (max-width: 780px) {
  .project-grid {
    grid-template-columns: 1fr;
  }

  .empty-card {
    border-radius: 24px;
  }
}
</style>