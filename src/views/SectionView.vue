<script setup lang="ts">
import { computed, inject, onMounted, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CHECK_SESSION_KEY, REFRESH_FAILURE_MESSAGE } from '../state/checkSession'
import WrittenInput from '../components/WrittenInput.vue'
import type { Item } from '../domain/types'

const session = inject(CHECK_SESSION_KEY)!
const route = useRoute()
const router = useRouter()

const sectionId = computed(() => route.params.sectionId as string)
const sectionIndex = computed(() => session.progress.value.findIndex((entry) => entry.section.id === sectionId.value))
const currentEntry = computed(() => (sectionIndex.value >= 0 ? session.progress.value[sectionIndex.value] : null))

const prevSectionId = computed(() =>
  sectionIndex.value > 0 ? session.progress.value[sectionIndex.value - 1].section.id : null,
)
const nextSectionId = computed(() =>
  sectionIndex.value >= 0 && sectionIndex.value < session.progress.value.length - 1
    ? session.progress.value[sectionIndex.value + 1].section.id
    : null,
)

function parentPath(): string {
  return `/${route.params.slug as string}/${route.params.applianceId as string}`
}

function goToSection(id: string | null): void {
  if (!id) return
  void router.replace({ path: `${parentPath()}/${id}`, query: route.query })
}

function backToSections(): void {
  void router.push({ path: parentPath(), query: route.query })
}

function isPending(item: Item): boolean {
  return session.isPending(item.id)
}

// While re-gating (the stamped version for a Check switch, or a version bump right after a
// write, hasn't resolved yet), taps must not be silently swallowed by `answer()`'s `ready` guard:
// blocking pointer events here (reusing the same `saving` look) means an in-flight tap simply
// waits rather than doing nothing with no feedback.
function isBlocked(item: Item): boolean {
  return isPending(item) || !session.ready.value
}

function answerYN(item: Item, value: 'Y' | 'N'): void {
  const current = session.responses.value[item.id]
  void session.answer(item.id, current === value ? null : value)
}

function answerChoice(item: Item, event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void session.answer(item.id, value === '' ? null : value)
}

function answerWritten(item: Item, value: string | null): void {
  void session.answer(item.id, value)
}

function previousValueDisplay(item: Item): string | null {
  return session.previousValueFor(item.id)
}

function copyPrevious(item: Item): void {
  const value = previousValueDisplay(item)
  if (value !== null) void session.answer(item.id, value)
}

async function loadSection(): Promise<void> {
  try {
    await session.refresh()
  } catch {
    session.showToast(REFRESH_FAILURE_MESSAGE, true)
  }
}

onMounted(loadSection)
watch(sectionId, loadSection)
// Switching the Check via the header selector while a Section is open re-reads the newly
// selected Check too, the same way opening a Section does.
watch(session.selectedDate, loadSection)

watchEffect(() => {
  if (!session.loading.value && session.progress.value.length > 0 && sectionIndex.value === -1) {
    void router.replace({ path: parentPath(), query: route.query })
  }
})
</script>

<template>
  <div
    v-if="currentEntry"
    class="screen active screen-items"
  >
    <div class="items-section-header">
      <button
        class="header-nav-btn"
        :disabled="!prevSectionId"
        @click="goToSection(prevSectionId)"
      >
        <span class="chev chev-left" />
      </button>
      <div class="items-section-title-wrap">
        <div class="items-section-name">
          {{ currentEntry.section.title }}
        </div>
        <div class="items-section-count">
          {{ currentEntry.due.length }} items
        </div>
      </div>
      <button
        class="header-nav-btn"
        :disabled="!nextSectionId"
        @click="goToSection(nextSectionId)"
      >
        <span class="chev chev-right" />
      </button>
    </div>

    <div
      v-for="item in currentEntry.due"
      :key="item.id"
      class="item-row"
    >
      <div class="item-meta">
        <div class="item-label">
          {{ item.label }}
        </div>
        <div
          v-if="item.qty && item.qty !== 'n/a' && item.qty !== '-'"
          class="item-qty"
        >
          ×{{ item.qty }}
        </div>
      </div>

      <div
        v-if="item.inputType === 'yn'"
        class="yn-row"
      >
        <div class="yn-buttons">
          <button
            :class="[
              'yn-btn',
              session.responses.value[item.id] === 'Y' ? 'y-active' : '',
              isBlocked(item) ? 'saving' : '',
            ]"
            @click="answerYN(item, 'Y')"
          >
            Y
          </button>
          <button
            :class="[
              'yn-btn',
              session.responses.value[item.id] === 'N' ? 'n-active' : '',
              isBlocked(item) ? 'saving' : '',
            ]"
            @click="answerYN(item, 'N')"
          >
            N
          </button>
        </div>
      </div>

      <select
        v-else-if="item.inputType === 'choice'"
        :class="['item-select', isBlocked(item) ? 'saving' : '']"
        :value="session.responses.value[item.id] ?? ''"
        @change="answerChoice(item, $event)"
      >
        <option value="">
          — select —
        </option>
        <option
          v-for="opt in item.options ?? []"
          :key="opt"
          :value="opt"
        >
          {{ opt }}
        </option>
      </select>

      <div
        v-else
        class="text-input-wrap"
      >
        <WrittenInput
          :value="session.responses.value[item.id] ?? ''"
          :blocked="isBlocked(item)"
          @commit="(value) => answerWritten(item, value)"
        />
        <button
          v-if="!session.responses.value[item.id] && previousValueDisplay(item)"
          :class="['copy-prev-btn', isBlocked(item) ? 'saving' : '']"
          @click="copyPrevious(item)"
        >
          <span class="copy-prev-label">Copy from previous</span>
          <span class="copy-prev-val">{{ previousValueDisplay(item) }}</span>
        </button>
      </div>
    </div>

    <div class="section-bottom-nav">
      <button
        class="nav-btn items-section-nav"
        :disabled="!prevSectionId"
        @click="goToSection(prevSectionId)"
      >
        <span class="nav-chevron"><span class="chev chev-left" /></span>
        <span class="nav-label">Prev</span>
      </button>
      <button
        class="nav-btn section-back-btn"
        @click="backToSections"
      >
        Back to sections
      </button>
      <button
        class="nav-btn items-section-nav"
        :disabled="!nextSectionId"
        @click="goToSection(nextSectionId)"
      >
        <span class="nav-label">Next</span>
        <span class="nav-chevron"><span class="chev chev-right" /></span>
      </button>
    </div>
  </div>
</template>
