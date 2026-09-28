<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AdminFrame from '../../components/AdminFrame.vue'
import { createAdminUser, deleteAdminUser, listAdminUsers, updateAdminUser } from '../../data/admin'
import { type AdminUserDraft, normaliseAdminUser } from '../../domain/adminUser'
import type { AdminRole, AdminUser } from '../../domain/types'
import { isPermissionDenied, useAdminGate } from '../../state/adminGate'

interface Toast {
  text: string
  isError: boolean
}

const gate = useAdminGate()

const users = ref<AdminUser[]>([])
const usersLoading = ref(false)
const usersError = ref<string | null>(null)

const editingEmail = ref<string | null>(null)
const formProblem = ref<string | null>(null)
const toast = ref<Toast | null>(null)

function emptyDraft(): AdminUserDraft {
  return { email: '', displayName: '', role: 'brigadeAdmin', brigadeIds: [] }
}

const draft = reactive<AdminUserDraft>(emptyDraft())

const singleBrigadeId = computed<string>({
  get: () => draft.brigadeIds[0] ?? '',
  set: (value: string) => {
    draft.brigadeIds = value ? [value] : []
  },
})

function roleLabel(role: AdminRole): string {
  return role === 'brigadeAdmin' ? 'Brigade Admin' : 'VSO'
}

function brigadeName(id: string): string {
  return gate.brigades.value.find((entry) => entry.brigade.brigadeId === id)?.brigade.name ?? id
}

function brigadeNames(ids: string[]): string {
  return ids.map(brigadeName).join(', ')
}

function showToast(text: string, isError: boolean): void {
  toast.value = { text, isError }
  setTimeout(() => {
    toast.value = null
  }, 4000)
}

watch(
  () => gate.loading.value,
  async (loading) => {
    if (loading || gate.notAuthorised.value || gate.error.value) return
    usersLoading.value = true
    try {
      users.value = await listAdminUsers()
    } catch (err) {
      console.error(err)
      usersError.value = "Couldn't load admin users."
    } finally {
      usersLoading.value = false
    }
  },
  { immediate: true },
)

// The Brigade Admin picker only shows the first brigade, so drop the rest rather than fail
// validation on a selection the form isn't showing.
watch(
  () => draft.role,
  (role) => {
    if (role === 'brigadeAdmin' && draft.brigadeIds.length > 1) draft.brigadeIds = draft.brigadeIds.slice(0, 1)
  },
)

async function refreshUsers(): Promise<void> {
  try {
    users.value = await listAdminUsers()
  } catch (err) {
    console.error(err)
    showToast("Couldn't reload admin users", true)
  }
}

function resetForm(): void {
  editingEmail.value = null
  Object.assign(draft, emptyDraft())
  formProblem.value = null
}

function startEdit(user: AdminUser): void {
  editingEmail.value = user.email
  draft.email = user.email
  draft.displayName = user.displayName ?? ''
  draft.role = user.role
  draft.brigadeIds = [...user.brigadeIds]
  formProblem.value = null
}

async function save(): Promise<void> {
  formProblem.value = null
  const email = editingEmail.value
  const result = normaliseAdminUser(draft)
  if (!result.ok) {
    formProblem.value = result.problem
    return
  }

  if (email === null && users.value.some((user) => user.email === result.user.email)) {
    formProblem.value = 'Already added.'
    return
  }

  try {
    if (email === null) {
      await createAdminUser(result.user)
    } else {
      await updateAdminUser(email, {
        displayName: result.user.displayName,
        role: result.user.role,
        brigadeIds: result.user.brigadeIds,
      })
    }
  } catch (err) {
    console.error(err)
    showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't save", true)
    return
  }
  resetForm()
  await refreshUsers()
}

async function remove(): Promise<void> {
  const email = editingEmail.value
  if (!email) return
  if (!window.confirm(`Remove ${email}?`)) return

  try {
    await deleteAdminUser(email)
  } catch (err) {
    console.error(err)
    showToast(isPermissionDenied(err) ? 'Not authorised.' : "Couldn't remove", true)
    return
  }
  resetForm()
  await refreshUsers()
}
</script>

<template>
  <AdminFrame
    title="User admin"
    :loading="gate.loading.value || usersLoading"
    :not-authorised="gate.notAuthorised.value"
    :error="gate.error.value ?? usersError"
  >
    <div class="screen active screen-picker">
      <div
        v-for="user in users"
        :key="user.email"
        class="appliance-card"
        @click="startEdit(user)"
      >
        <div class="appliance-card-name">
          {{ user.email }}
          <div class="section-card-meta">
            {{ user.displayName ? `${user.displayName} · ` : '' }}{{ roleLabel(user.role) }} · {{ brigadeNames(user.brigadeIds) }}
          </div>
        </div>
      </div>

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
            v-for="entry in gate.brigades.value"
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
            v-for="entry in gate.brigades.value"
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
          <button
            type="button"
            class="nav-btn section-back-btn"
            @click="resetForm"
          >
            Cancel
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
