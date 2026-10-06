<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminFrame from '../../components/AdminFrame.vue'
import { AdminUserExists, createAdminUser, deleteAdminUser, getAdminUser, listBrigades, updateAdminUser } from '../../data/admin'
import { type AdminUserDraft, normaliseAdminUser } from '../../domain/adminUser'
import { isPermissionDenied, NOT_AUTHORISED, useAdminGate } from '../../state/adminGate'

interface Toast {
  text: string
  isError: boolean
}

const route = useRoute()
const router = useRouter()
// Null on `/admin/users/new`.
const editingEmail = typeof route.params.email === 'string' ? route.params.email : null

const draft = reactive<AdminUserDraft>({ email: '', displayName: '', role: 'brigadeAdmin', brigadeIds: [] })

const gate = useAdminGate(
  async (profile) => {
    if (profile.kind !== 'superadmin') return NOT_AUTHORISED
    const [brigades, user] = await Promise.all([
      listBrigades(),
      editingEmail === null ? Promise.resolve(null) : getAdminUser(editingEmail),
    ])
    if (user) {
      Object.assign(draft, {
        email: user.email,
        displayName: user.displayName ?? '',
        role: user.role,
        brigadeIds: [...user.brigadeIds],
      })
    }
    return { brigades, missing: editingEmail !== null && user === null }
  },
  "Couldn't load this user.",
)
const brigades = computed(() => gate.data.value?.brigades ?? [])
const frameError = computed(() => gate.error.value ?? (gate.data.value?.missing ? 'No such user.' : null))

const formProblem = ref<string | null>(null)
const saving = ref(false)
const toast = ref<Toast | null>(null)

const singleBrigadeId = computed<string>({
  get: () => draft.brigadeIds[0] ?? '',
  set: (value: string) => {
    draft.brigadeIds = value ? [value] : []
  },
})

// The Brigade Admin picker only shows the first brigade, so drop the rest rather than fail
// validation on a selection the form isn't showing.
watch(
  () => draft.role,
  (role) => {
    if (role === 'brigadeAdmin' && draft.brigadeIds.length > 1) draft.brigadeIds = draft.brigadeIds.slice(0, 1)
  },
)

function showToast(text: string, isError: boolean): void {
  toast.value = { text, isError }
  setTimeout(() => {
    toast.value = null
  }, 4000)
}

async function save(): Promise<void> {
  formProblem.value = null
  const result = normaliseAdminUser(draft)
  if (!result.ok) {
    formProblem.value = result.problem
    return
  }

  saving.value = true
  try {
    if (editingEmail === null) {
      await createAdminUser(result.user)
    } else {
      await updateAdminUser(editingEmail, {
        displayName: result.user.displayName,
        role: result.user.role,
        brigadeIds: result.user.brigadeIds,
      })
    }
  } catch (err) {
    if (err instanceof AdminUserExists) {
      formProblem.value = 'Already added.'
    } else {
      console.error(err)
      showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't save", true)
    }
    return
  } finally {
    saving.value = false
  }
  await router.push('/admin/users')
}

async function remove(): Promise<void> {
  if (editingEmail === null) return
  if (!window.confirm(`Remove ${editingEmail}?`)) return

  try {
    await deleteAdminUser(editingEmail)
  } catch (err) {
    console.error(err)
    showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't remove", true)
    return
  }
  await router.push('/admin/users')
}
</script>

<template>
  <AdminFrame
    :title="editingEmail === null ? 'New user' : 'Edit user'"
    :up="{ to: '/admin/users', label: '‹ Users' }"
    :loading="gate.loading.value"
    :not-authorised="gate.notAuthorised.value"
    :error="frameError"
  >
    <div class="screen active screen-picker">
      <form @submit.prevent="save">
        <div class="picker-heading">
          Email
        </div>
        <input
          v-model="draft.email"
          type="email"
          :readonly="editingEmail !== null"
          class="item-input"
        >

        <div class="picker-heading">
          Display name
        </div>
        <input
          v-model="draft.displayName"
          type="text"
          class="item-input"
        >

        <div class="picker-heading">
          Role
        </div>
        <select
          v-model="draft.role"
          class="item-select role-select"
        >
          <option value="brigadeAdmin">
            Brigade Admin
          </option>
          <option value="vso">
            VSO
          </option>
        </select>

        <div class="picker-heading">
          Brigade(s)
        </div>
        <select
          v-if="draft.role === 'brigadeAdmin'"
          v-model="singleBrigadeId"
          class="item-select brigade-select"
        >
          <option value="">
            Pick a brigade
          </option>
          <option
            v-for="entry in brigades"
            :key="entry.brigade.brigadeId"
            :value="entry.brigade.brigadeId"
          >
            {{ entry.brigade.name }}
          </option>
        </select>
        <div
          v-else
          class="checkbox-list"
        >
          <label
            v-for="entry in brigades"
            :key="entry.brigade.brigadeId"
            class="checkbox-row"
          >
            <input
              v-model="draft.brigadeIds"
              type="checkbox"
              :value="entry.brigade.brigadeId"
            >
            {{ entry.brigade.name }}
          </label>
        </div>

        <p
          v-if="formProblem"
          class="error-msg"
        >
          {{ formProblem }}
        </p>

        <button
          type="submit"
          class="copy-prev-btn"
          :disabled="saving"
        >
          {{ editingEmail === null ? 'Add' : 'Save' }}
        </button>

        <div
          v-if="editingEmail !== null"
          class="section-bottom-nav"
        >
          <button
            type="button"
            class="nav-btn section-back-btn"
            @click="remove"
          >
            Remove
          </button>
        </div>
      </form>
    </div>

    <div
      id="toast"
      :class="{ show: toast, error: toast?.isError }"
    >
      {{ toast?.text }}
    </div>
  </AdminFrame>
</template>
