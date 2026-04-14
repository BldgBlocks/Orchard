<script setup>
import { computed } from 'vue';

const props = defineProps({
  config: {
    type: Object,
    default: null,
  },
  health: {
    type: Object,
    required: true,
  },
  validation: {
    type: Object,
    default: null,
  },
  dockerStatusText: {
    type: String,
    required: true,
  },
  themeToggleIcon: {
    type: String,
    required: true,
  },
  schedulerSummary: {
    type: String,
    required: true,
  },
  schedulerNextRunLabel: {
    type: String,
    required: true,
  },
  loadingProjects: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['open-settings', 'refresh', 'toggle-theme']);

const dockerIssueText = computed(() => {
  if (props.health?.dockerAccessible) {
    return '';
  }

  return props.health?.dockerMessage
    ? `Docker commands are unavailable inside Orchard. ${props.health.dockerMessage}`
    : 'Docker commands are unavailable inside Orchard. Check the Docker socket mount and container permissions.';
});

const workPathIssueText = computed(() => {
  if (!props.validation || props.validation.ok) {
    return '';
  }

  return `The configured work path is not usable inside the container. ${props.validation.message}`;
});
</script>

<template>
  <section class="hero-banner">
    <div class="hero-copy">
      <p class="eyebrow">Orchard</p>
      <h1>Folder-first Docker app maintenance.</h1>
      <p class="hero-text">
        Every app as a subfolder in its own directory with a compose file, automate simple management tasks with an overall view.
      </p>

      <div class="hero-chip-row">
        <v-chip class="font-mono" color="primary" variant="tonal">
          <v-icon icon="mdi-folder-cog-outline" start />
          {{ config?.workPath || '/workspace' }}
        </v-chip>
      </div>

      <div v-if="dockerIssueText || workPathIssueText" class="hero-notices">
        <v-alert
          v-if="dockerIssueText"
          density="comfortable"
          type="error"
          variant="tonal"
        >
          {{ dockerIssueText }}
        </v-alert>
        <v-alert
          v-if="workPathIssueText"
          density="comfortable"
          type="warning"
          variant="tonal"
        >
          {{ workPathIssueText }}
        </v-alert>
      </div>
    </div>

    <v-card class="hero-panel">
      <div class="panel-topline">
        <div>
          <p class="eyebrow">Current Sweep</p>
          <h2>{{ config?.batchTargetPaths?.length ? 'Saved Target Set' : 'All Apps' }}</h2>
        </div>
        <v-btn
          :icon="themeToggleIcon"
          title="Toggle between the Orchard day and night themes."
          variant="text"
          @click="$emit('toggle-theme')"
        />
      </div>

      <div class="hero-grid">
        <div>
          <span>Parallel jobs</span>
          <strong>{{ config?.maxParallelJobs || 3 }}</strong>
        </div>
        <div>
          <span>Scan depth</span>
          <strong>{{ config?.scanDepth || 3 }}</strong>
        </div>
        <div>
          <span>Auto refresh</span>
          <strong>{{ config?.autoRefreshSeconds || 0 }}s</strong>
        </div>
        <div>
          <span>Scheduled sweeps</span>
          <strong>{{ schedulerSummary }}</strong>
        </div>
        <div>
          <span>Next run</span>
          <strong>{{ schedulerNextRunLabel }}</strong>
        </div>
        <div>
          <span>Self skip</span>
          <strong>{{ config?.skipSelfProject ? 'On' : 'Off' }}</strong>
        </div>
      </div>

      <div class="hero-actions">
        <v-btn
          color="primary"
          prepend-icon="mdi-cog-outline"
          title="Open Orchard settings for work path, scheduling, self-skip, and refresh behavior."
          @click="$emit('open-settings')"
        >
          Settings
        </v-btn>
        <v-btn
          :loading="loadingProjects"
          prepend-icon="mdi-refresh"
          title="Refresh app discovery, Docker health, scheduler status, and activity snapshots."
          variant="tonal"
          @click="$emit('refresh')"
        >
          Refresh
        </v-btn>
      </div>
    </v-card>
  </section>
</template>

<style scoped>
.hero-banner {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1.6fr 1fr;
}

.hero-copy,
.hero-panel {
  backdrop-filter: blur(20px);
  background: var(--orchard-panel-bg);
  border: 1px solid var(--orchard-panel-border);
  box-shadow: var(--orchard-panel-shadow);
}

.hero-copy {
  border-radius: 32px;
  padding: 2rem;
  position: relative;
}

.hero-copy::after {
  background: linear-gradient(135deg, rgba(75, 122, 49, 0.24), rgba(201, 61, 57, 0.16));
  border-radius: 999px;
  content: '';
  height: 13rem;
  position: absolute;
  right: -2rem;
  top: -2rem;
  width: 13rem;
}

.hero-copy h1 {
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 1.02;
  margin: 0;
  max-width: 12ch;
  position: relative;
  z-index: 1;
}

.hero-text {
  font-size: 1.05rem;
  margin: 1rem 0 0;
  max-width: 58ch;
  opacity: 0.84;
  position: relative;
  z-index: 1;
}

.hero-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
  position: relative;
  z-index: 1;
}

.hero-panel {
  border-radius: 32px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
}

.hero-notices {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
  position: relative;
  z-index: 1;
}

.panel-topline {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.hero-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.hero-grid span {
  display: block;
  font-size: 0.78rem;
  opacity: 0.68;
  text-transform: uppercase;
}

.hero-grid strong {
  display: block;
  font-size: 1.35rem;
  margin-top: 0.25rem;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: auto;
}

.eyebrow {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0;
  opacity: 0.65;
  text-transform: uppercase;
}

.hero-panel h2 {
  margin: 0;
}

@media (max-width: 1260px) {
  .hero-banner {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }

  .hero-copy,
  .hero-panel {
    border-radius: 24px;
  }
}
</style>