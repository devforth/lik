<script setup lang="ts">
import type { ProgressRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ProgressRoot, ProgressIndicator } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<ProgressRootProps & { class?: HTMLAttributes['class']; indicatorClass?: string }>(),
  { modelValue: 0, indicatorClass: 'bg-primary' }
)

const delegated = reactiveOmit(props, 'class', 'indicatorClass')
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegated"
    :class="cn('bg-muted relative h-2 w-full overflow-hidden rounded-full', props.class)"
  >
    <ProgressIndicator
      data-slot="progress-indicator"
      class="h-full w-full transition-all"
      :class="props.indicatorClass"
      :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%);`"
    />
  </ProgressRoot>
</template>
