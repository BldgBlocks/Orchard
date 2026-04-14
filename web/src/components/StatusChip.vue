<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: {
    type: String,
    default: 'unknown',
  },
});

const palette = computed(() => {
  const map = {
    healthy: {
      color: 'success',
      icon: 'mdi-heart-pulse',
      label: 'Healthy',
      tooltip: 'All discovered services in this app are running, and every service with a health check is healthy.',
    },
    running: {
      color: 'primary',
      icon: 'mdi-play-circle',
      label: 'Running',
      tooltip: 'All discovered services are running, but at least one service has no health check or has not reported healthy status.',
    },
    degraded: {
      color: 'warning',
      icon: 'mdi-alert-circle',
      label: 'Degraded',
      tooltip: 'Part of this app is running, restarting, mixed, or unhealthy, but the full app is not in a clean healthy state.',
    },
    stopped: {
      color: 'grey-darken-1',
      icon: 'mdi-stop-circle',
      label: 'Stopped',
      tooltip: 'No discovered services in this app are currently running.',
    },
    skipped: {
      color: 'blue-grey',
      icon: 'mdi-skip-next-circle',
      label: 'Skipped',
      tooltip: 'This item was intentionally left alone during the current operation.',
    },
    queued: {
      color: 'secondary',
      icon: 'mdi-timer-sand',
      label: 'Queued',
      tooltip: 'This item is waiting for its turn in the current operation queue.',
    },
    completed: {
      color: 'success',
      icon: 'mdi-check-circle',
      label: 'Complete',
      tooltip: 'This item finished successfully in the current operation.',
    },
    attention: {
      color: 'warning',
      icon: 'mdi-alert-decagram',
      label: 'Attention',
      tooltip: 'The operation completed, but at least one app reported a failure or warning that needs review.',
    },
    failed: {
      color: 'error',
      icon: 'mdi-close-circle',
      label: 'Failed',
      tooltip: 'This item failed during the current operation.',
    },
    cancelled: {
      color: 'error',
      icon: 'mdi-cancel',
      label: 'Cancelled',
      tooltip: 'This item was cancelled before it finished.',
    },
    unknown: {
      color: 'grey',
      icon: 'mdi-help-circle',
      label: 'Unknown',
      tooltip: 'Orchard could not determine a clear state for this app from the discovered compose services.',
    },
  };

  return map[props.status] || map.unknown;
});
</script>

<template>
  <v-tooltip :text="palette.tooltip" location="top">
    <template #activator="{ props: tooltipProps }">
      <v-chip class="status-chip" :color="palette.color" size="small" variant="tonal" v-bind="tooltipProps">
        <v-icon :icon="palette.icon" start />
        {{ palette.label }}
      </v-chip>
    </template>
  </v-tooltip>
</template>

<style scoped>
.status-chip {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
