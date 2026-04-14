<script setup>
const props = defineProps({
  search: {
    type: String,
    required: true,
  },
  statusFilter: {
    type: String,
    required: true,
  },
  statusOptions: {
    type: Array,
    required: true,
  },
  hasSelection: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:search', 'update:statusFilter', 'clear-selection']);
</script>

<template>
  <v-card class="toolbar-card mt-5">
    <div class="toolbar-row">
      <v-text-field
        :model-value="props.search"
        hide-details
        label="Search apps, folders, or services"
        prepend-inner-icon="mdi-magnify"
        @update:model-value="emit('update:search', $event)"
      />
      <v-select
        :items="statusOptions"
        :model-value="props.statusFilter"
        hide-details
        item-title="title"
        item-value="value"
        label="Status filter"
        @update:model-value="emit('update:statusFilter', $event)"
      />
      <v-btn
        :disabled="!hasSelection"
        title="Clear the saved batch target selection and go back to running against all apps."
        variant="text"
        @click="emit('clear-selection')"
      >
        Clear saved targets
      </v-btn>
    </div>
    <p class="toolbar-note">
      Card selection is persisted becomes the default target for batch and scheduled runs.
    </p>
  </v-card>
</template>

<style scoped>
.toolbar-card {
  backdrop-filter: blur(20px);
  background: var(--orchard-panel-bg);
  border: 1px solid var(--orchard-panel-border);
  border-radius: 28px;
  box-shadow: var(--orchard-panel-shadow);
  padding: 1.25rem;
}

.toolbar-row {
  align-items: stretch;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.toolbar-row > * {
  flex: 1 1 0;
}

.toolbar-note {
  margin: 0.85rem 0 0;
  opacity: 0.72;
}

@media (max-width: 780px) {
  .toolbar-row {
    flex-direction: column;
  }

  .toolbar-card {
    border-radius: 24px;
  }
}
</style>