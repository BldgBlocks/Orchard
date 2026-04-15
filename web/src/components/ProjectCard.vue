<script setup>
import { computed, ref } from 'vue';

import StatusChip from './StatusChip.vue';

const props = defineProps({
  project: {
    type: Object,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  busy: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['action', 'toggle-select']);

function isProjectStopped() {
  return Number(props.project.runningServices || 0) === 0;
}

function canStopProject() {
  return !isProjectStopped();
}

const servicesExpanded = ref(false);

const visibleServices = computed(() => {
  const services = props.project.services || [];
  return servicesExpanded.value ? services : services.slice(0, 2);
});

const hiddenServiceCount = computed(() => {
  const services = props.project.services || [];
  return Math.max(services.length - visibleServices.value.length, 0);
});

const selectionDisabled = computed(() => props.busy || props.disabled || props.project.isSelfProject);
const actionDisabled = computed(() => props.busy || props.disabled || props.project.isSelfProject);
</script>

<template>
  <v-card
    :class="[
      'project-card',
      {
        'project-card-stopped': isProjectStopped(),
        'project-card-degraded': project.status === 'degraded',
      },
    ]"
  >
    <div class="project-topline">
      <div>
        <div class="d-flex align-center ga-2 flex-wrap">
          <h3 class="project-title">{{ project.name }}</h3>
          <StatusChip :status="project.status" />
          <v-chip v-if="project.isSelfProject" color="accent" size="small" variant="outlined">
            <v-icon icon="mdi-shield-home-outline" start />
            Self App
          </v-chip>
          <v-chip v-if="busy" color="secondary" size="small" variant="outlined">
            <v-icon icon="mdi-progress-clock" start />
            Active Job
          </v-chip>
        </div>
        <p class="project-path font-mono" :title="project.relativePath">
          {{ project.relativePath }}
        </p>
      </div>

      <v-checkbox-btn
        :disabled="selectionDisabled"
        :model-value="selected"
        title="Add or remove this app from the current batch selection."
        @update:model-value="$emit('toggle-select', project.id)"
      />
    </div>

    <div class="metric-strip">
      <div>
        <span>Folders</span>
        <strong>{{ project.composeDirectoryCount }}</strong>
      </div>
      <div>
        <span>Services</span>
        <strong>{{ project.serviceCount }}</strong>
      </div>
      <div>
        <span>Running</span>
        <strong>{{ project.runningServices }}</strong>
      </div>
      <div>
        <span>Healthy</span>
        <strong>{{ project.healthyServices }}</strong>
      </div>
    </div>

    <div class="summary-block">
      <div class="summary-topline">
        <span class="summary-label">Services</span>
        <v-btn
          v-if="project.services.length > 2"
          size="x-small"
          title="Show or hide the full service list for this app."
          variant="text"
          @click="servicesExpanded = !servicesExpanded"
        >
          {{ servicesExpanded ? 'Less' : `+${hiddenServiceCount}` }}
        </v-btn>
      </div>

      <div v-if="project.services.length" class="service-badges compact-service-badges">
        <v-chip
          v-for="service in visibleServices"
          :key="service.name"
          class="service-chip"
          size="x-small"
          variant="outlined"
        >
          {{ service.name }}
        </v-chip>
      </div>
      <div v-else class="summary-empty">
        No discovered services
      </div>
    </div>

    <v-alert v-if="project.error" class="mt-4" density="comfortable" type="warning" variant="tonal">
      {{ project.error }}
    </v-alert>
    <v-alert
      v-else-if="project.isSelfProject"
      class="mt-4 self-project-note"
      density="comfortable"
      type="info"
      variant="tonal"
    >
      Orchard cannot safely redeploy its own container from inside this UI.
    </v-alert>

    <div class="action-row">
      <v-btn
        :disabled="actionDisabled"
        color="primary"
        size="small"
        title="Check for new image layers, then update this app only if new images were pulled."
        @click="$emit('action', { projectId: project.id, mode: 'smart' })"
      >
        Smart Sweep
      </v-btn>
      <v-btn
        :disabled="actionDisabled"
        color="secondary"
        size="small"
        title="Always pull images, then update this app."
        variant="tonal"
        @click="$emit('action', { projectId: project.id, mode: 'force-update' })"
      >
        Force Update
      </v-btn>
      <v-btn
        :disabled="actionDisabled"
        color="warning"
        size="small"
        title="Restart this app without pulling images first."
        variant="text"
        @click="$emit('action', { projectId: project.id, mode: 'restart-only' })"
      >
        Restart Only
      </v-btn>
      <v-btn
        :disabled="actionDisabled"
        color="success"
        size="small"
        title="Start this app by running docker compose up -d in each compose folder for the app."
        variant="text"
        @click="$emit('action', { projectId: project.id, mode: 'start-only' })"
      >
        Start
      </v-btn>
      <v-btn
        :disabled="actionDisabled || !canStopProject()"
        color="error"
        size="small"
        :title="canStopProject()
          ? 'Stop this app by running docker compose down in each compose folder for the app.'
          : 'This app is already stopped.'"
        variant="text"
        @click="$emit('action', { projectId: project.id, mode: 'stop-only' })"
      >
        Stop
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.project-card {
  background: var(--orchard-project-card-bg);
  border: 1px solid var(--orchard-panel-border);
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.85rem;
  transition: opacity 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
}

.project-card-stopped {
  background: var(--orchard-project-card-stopped-bg);
  border-color: var(--orchard-project-card-stopped-border);
  opacity: 0.72;
}

.project-card-degraded {
  background:
    linear-gradient(180deg, var(--orchard-project-card-degraded-tint), transparent 42%),
    var(--orchard-project-card-bg);
  border-color: var(--orchard-project-card-degraded-border);
  box-shadow: inset 0 0 0 1px var(--orchard-project-card-degraded-border);
}

.project-topline {
  align-items: flex-start;
  display: flex;
  gap: 0.65rem;
  justify-content: space-between;
}

.project-title {
  font-size: 1rem;
  line-height: 1.2;
  margin: 0;
}

.project-path {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  opacity: 0.8;
}

.metric-strip {
  display: grid;
  gap: 0.35rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.metric-strip > div {
  min-width: 0;
}

.metric-strip span {
  display: block;
  font-size: 0.64rem;
  opacity: 0.68;
  text-transform: uppercase;
}

.metric-strip strong {
  display: block;
  font-size: 0.9rem;
  margin-top: 0.05rem;
}

.summary-block {
  background: rgba(15, 23, 42, 0.04);
  border-radius: 12px;
  display: grid;
  gap: 0.3rem;
  padding: 0.5rem 0.65rem;
}

.summary-topline {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.summary-label {
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  opacity: 0.66;
  text-transform: uppercase;
}

.action-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.5rem;
  margin-top: auto;
}

.compact-service-badges {
  gap: 0.28rem;
}

.action-row :deep(.v-btn) {
  min-width: 0;
}

.summary-empty {
  font-size: 0.74rem;
  opacity: 0.72;
}

.self-project-note {
  font-size: 0.82rem;
}

@media (max-width: 720px) {
  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
