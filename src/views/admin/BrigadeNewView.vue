<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import BrigadeDetailsForm from '../../components/admin/BrigadeDetailsForm.vue'
import AdminFrame from '../../components/AdminFrame.vue'
import { createBrigade } from '../../data/admin'
import type { BrigadeDraft, NormalisedBrigade } from '../../domain/brigade'
import { isPermissionDenied, NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'

const router = useRouter()

const gate = useAdminGate(
  async (profile) => (profile.kind === 'superadmin' ? true : NOT_AUTHORISED),
  "Couldn't load your admin access.",
)

const initial: BrigadeDraft = { name: '', checkDay: null, active: true }
const saving = ref(false)
const problem = ref<string | null>(null)

async function save(brigade: NormalisedBrigade): Promise<void> {
  saving.value = true
  problem.value = null
  try {
    const slug = await createBrigade(brigade)
    await router.push(`/${slug}/admin`)
  } catch (err) {
    console.error(err)
    problem.value = isPermissionDenied(err) ? 'Not authorised.' : "Couldn't create the brigade."
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AdminFrame
    title="New brigade"
    :up="{ to: '/admin/brigades', label: '‹ Brigades' }"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="gate.error.value"
  >
    <div class="screen active screen-picker">
      <BrigadeDetailsForm
        class="admin-form"
        :initial="initial"
        active="hidden"
        submit-label="Create"
        :saving="saving"
        @save="save"
      />
      <p
        v-if="problem"
        class="error-msg"
      >
        {{ problem }}
      </p>
    </div>
  </AdminFrame>
</template>
