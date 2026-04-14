<script setup>
defineProps({
  statCards: {
    type: Array,
    required: true,
  },
});
</script>

<template>
  <v-row class="mt-4" dense>
    <v-col v-for="card in statCards" :key="card.label" cols="12" md="6" lg="3">
      <v-card class="metric-card">
        <div class="metric-topline">
          <v-avatar :color="card.color" size="42" variant="tonal">
            <v-icon :icon="card.icon" />
          </v-avatar>
          <span>{{ card.label }}</span>
        </div>
        <strong>{{ card.value }}</strong>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.metric-card {
  backdrop-filter: blur(20px);
  background: var(--orchard-panel-bg);
  border: 1px solid var(--orchard-panel-border);
  border-radius: 28px;
  box-shadow: var(--orchard-panel-shadow);
  padding: 1.25rem;
}

.metric-topline {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: flex-start;
}

.metric-card span {
  display: block;
  font-size: 0.78rem;
  opacity: 0.68;
  text-transform: uppercase;
}

.metric-card strong {
  display: block;
  font-size: 1.35rem;
  margin-top: 0.25rem;
}

@media (max-width: 780px) {
  .metric-card {
    border-radius: 24px;
  }
}
</style>