<script setup>
defineProps({
  actionDeck: {
    type: Array,
    required: true,
  },
  targetLabel: {
    type: String,
    required: true,
  },
  targetCount: {
    type: Number,
    required: true,
  },
  actionsDisabled: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['run-batch']);
</script>

<template>
  <v-row class="mt-3" dense>
    <v-col cols="12" lg="8">
      <v-card class="action-card">
        <div class="section-header">
          <div>
            <p class="eyebrow">Batch Controls</p>
            <h2>Sweep {{ targetLabel }}</h2>
          </div>
          <v-chip variant="outlined">
            {{ targetCount }} target{{ targetCount === 1 ? '' : 's' }}
          </v-chip>
        </div>

        <div class="mode-grid">
          <v-card v-for="mode in actionDeck" :key="mode.value" class="mode-tile">
            <div class="d-flex align-center justify-space-between ga-3">
              <div>
                <h3>{{ mode.label }}</h3>
                <p>{{ mode.description }}</p>
              </div>
              <v-chip :color="mode.color" size="small" variant="tonal">{{ mode.value }}</v-chip>
            </div>

            <code class="command-preview">{{ mode.commandPreview }}</code>

            <v-btn
              :color="mode.color"
              :disabled="actionsDisabled"
              block
              class="mt-4"
              :title="`Queue ${mode.label} for ${targetLabel}.`"
              @click="$emit('run-batch', mode.value)"
            >
              Run {{ mode.label }}
            </v-btn>
          </v-card>
        </div>
      </v-card>
    </v-col>

    <v-col cols="12" lg="4">
      <v-card class="action-card transparency-card">
        <p class="eyebrow">Simply</p>
        <h2>No labels. No bloat.</h2>
        <div class="transparency-list">
          <div>
            <strong>App-first discovery</strong>
            <p>It groups compose folders under one top-level app instead of flooding the UI with every internal compose folder.</p>
          </div>
          <div>
            <strong>Built-in scheduling</strong>
            <p>Automatic sweeps use an internal timer in this app, no outside timing required.</p>
          </div>
          <div>
            <strong>Live command logs</strong>
            <p>Every pull, down, and up step is streamed into the UI while it runs.</p>
          </div>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.action-card {
  backdrop-filter: blur(20px);
  background: var(--orchard-panel-bg);
  border: 1px solid var(--orchard-panel-border);
  border-radius: 28px;
  box-shadow: var(--orchard-panel-shadow);
  padding: 1.25rem;
}

.section-header {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.action-card h2 {
  margin: 0;
}

.mode-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
  margin-top: 1rem;
}

.mode-tile {
  border: 1px solid rgba(148, 163, 184, 0.18);
  padding: 1rem;
}

.mode-tile h3 {
  margin: 0;
}

.mode-tile p {
  margin: 0.4rem 0 0;
  opacity: 0.82;
}

.command-preview {
  background: rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  display: block;
  font-family: 'IBM Plex Mono', monospace;
  margin-top: 1rem;
  overflow-wrap: anywhere;
  padding: 0.85rem;
  white-space: normal;
}

.transparency-list {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.transparency-list p {
  margin: 0.2rem 0 0;
  opacity: 0.82;
}

.eyebrow {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0;
  opacity: 0.65;
  text-transform: uppercase;
}

@media (max-width: 780px) {
  .action-card {
    border-radius: 24px;
  }
}
</style>