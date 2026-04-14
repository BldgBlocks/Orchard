<script setup>
import { reactive, watch } from 'vue';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  settings: {
    type: Object,
    default: null,
  },
  validation: {
    type: Object,
    default: null,
  },
  modes: {
    type: Array,
    default: () => [],
  },
  saving: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'save']);

const localSettings = reactive({
  workPath: '/workspace',
  scanDepth: 3,
  maxParallelJobs: 3,
  autoRefreshSeconds: 30,
  scheduledSweepEnabled: false,
  scheduledSweepIntervalMinutes: 360,
  scheduledSweepMode: 'smart',
  skipSelfProject: true,
});

watch(
  () => props.settings,
  (nextSettings) => {
    if (!nextSettings) {
      return;
    }

    Object.assign(localSettings, nextSettings);
  },
  { immediate: true, deep: true },
);

function closeDialog() {
  emit('update:modelValue', false);
}

function submit() {
  emit('save', { ...localSettings });
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="760" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="settings-card">
      <div class="d-flex align-start justify-space-between ga-4 flex-wrap">
        <div>
          <p class="eyebrow">Settings</p>
          <h2 class="mt-1">Container runtime and orchard controls</h2>
        </div>

        <v-btn icon="mdi-close" title="Close settings without saving changes." variant="text" @click="closeDialog" />
      </div>

      <v-alert
        class="mt-4"
        :type="validation?.ok ? 'success' : 'warning'"
        variant="tonal"
      >
        {{ validation?.message || 'Set a mounted path that exists inside the container.' }}
      </v-alert>

      <div class="settings-grid">
        <v-text-field
          v-model="localSettings.workPath"
          hint="This must exist inside the container, usually from a mounted host directory."
          label="Work path"
          persistent-hint
          title="The path Orchard scans inside the container. This should usually be the mounted compose root such as /workspace."
        />
        <v-text-field
          v-model.number="localSettings.scanDepth"
          label="Scan depth"
          title="How many folder levels Orchard will search under the work path for compose files. Higher values scan deeper but take longer."
          type="number"
        />
        <v-text-field
          v-model.number="localSettings.maxParallelJobs"
          label="Max parallel jobs"
          title="Maximum number of apps Orchard will process at the same time during batch actions."
          type="number"
        />
        <v-text-field
          v-model.number="localSettings.autoRefreshSeconds"
          label="Auto refresh seconds"
          title="How often the dashboard refreshes discovery and health data automatically. Set 0 to disable auto refresh."
          type="number"
        />
        <v-switch
          v-model="localSettings.scheduledSweepEnabled"
          color="primary"
          inset
          label="Enable scheduled sweeps"
          title="Turn Orchard's built-in scheduler on or off. When enabled, Orchard queues automatic sweeps on the selected interval."
        />
        <v-text-field
          v-model.number="localSettings.scheduledSweepIntervalMinutes"
          label="Scheduled sweep interval (minutes)"
          min="1"
          title="How many minutes Orchard waits between automatic scheduled sweeps. Minimum 1 minute when scheduling is enabled."
          type="number"
        />
        <v-select
          v-model="localSettings.scheduledSweepMode"
          :items="modes"
          item-title="label"
          item-value="value"
          label="Scheduled sweep mode"
          title="Which action mode Orchard uses for automatic scheduled sweeps."
        />
        <v-switch
          v-model="localSettings.skipSelfProject"
          color="primary"
          inset
          label="Skip Orchard itself"
          title="Prevents Orchard from queueing its own deployment if its compose file appears inside the scanned work path."
        />
      </div>

      <p class="settings-note">
        Mount the host directory that contains your compose folders into the container, then point the work path at that mounted path. Scheduled sweeps use the app's built-in timer, not cron and not a Docker-native scheduler.
      </p>

      <div class="d-flex justify-end ga-3 mt-4 flex-wrap">
        <v-btn title="Close settings without applying changes." variant="text" @click="closeDialog">Cancel</v-btn>
        <v-btn :loading="saving" color="primary" title="Save the current settings to Orchard and refresh discovery." @click="submit">Save Settings</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.settings-card {
  border: 1px solid rgba(148, 163, 184, 0.18);
  padding: 1.4rem;
}

.settings-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 1.25rem;
}

.settings-note {
  margin: 0.5rem 0 0;
  opacity: 0.8;
}

@media (max-width: 720px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
