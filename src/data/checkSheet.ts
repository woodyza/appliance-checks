import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'
import type { PublishProblems } from '../domain/publishValidation'
import { type DraftEdit, type LoadedState, planDiscard, planDraftEdit, planPublish } from '../domain/sheetDraft'
import type { Appliance, CheckSheetDraft, CheckSheetVersion } from '../domain/types'
import { db } from '../firebase'
import type { ApplianceSummary } from './checks'

export class ApplianceIdTaken extends Error {
  constructor() {
    super('That id is already used')
  }
}

export class StaleEditor extends Error {
  constructor() {
    super('The Check Sheet changed')
  }
}

export class EditRefused extends Error {
  constructor(readonly draft: CheckSheetDraft | null) {
    super('That edit no longer applies')
  }
}

export class SheetReplaced extends Error {
  constructor() {
    super('The Check Sheet was replaced since these edits started')
  }
}

export class PublishInvalid extends Error {
  constructor(
    readonly problems: PublishProblems,
    readonly draft: CheckSheetDraft,
  ) {
    super('The draft has problems')
  }
}

function applianceRef(slug: string, applianceId: string) {
  return doc(db, 'brigades', slug, 'appliances', applianceId)
}

function draftRef(slug: string, applianceId: string) {
  return doc(db, 'brigades', slug, 'appliances', applianceId, 'private', 'checkSheetDraft')
}

// Plain data only: no reactive proxies, and no `undefined` field values (Firestore rejects them).
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export async function listAllAppliances(slug: string): Promise<ApplianceSummary[]> {
  const snapshot = await getDocs(collection(db, 'brigades', slug, 'appliances'))
  return snapshot.docs
    .map((snap) => ({ id: snap.id, ...(snap.data() as Appliance) }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign))
}

export async function getDraft(slug: string, applianceId: string): Promise<CheckSheetDraft | null> {
  const snapshot = await getDoc(draftRef(slug, applianceId))
  return snapshot.exists() ? (snapshot.data() as CheckSheetDraft) : null
}

export async function addAppliance(slug: string, id: string, callsign: string): Promise<void> {
  const ref = applianceRef(slug, id)
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new ApplianceIdTaken()
    tx.set(ref, { callsign, active: true, currentCheckSheetVersion: null })
  })
}

export async function updateAppliance(
  slug: string,
  id: string,
  fields: Partial<Pick<Appliance, 'callsign' | 'active'>>,
): Promise<void> {
  await updateDoc(applianceRef(slug, id), fields)
}

function pointerOf(data: Partial<Appliance> | undefined): number | null {
  return data?.currentCheckSheetVersion ?? null
}

export async function editDraft(
  slug: string,
  applianceId: string,
  loaded: LoadedState,
  base: CheckSheetVersion | null,
  edit: DraftEdit,
): Promise<CheckSheetDraft | null> {
  const appliance = applianceRef(slug, applianceId)
  const draftDoc = draftRef(slug, applianceId)
  return runTransaction(db, async (tx) => {
    const applianceSnap = await tx.get(appliance)
    const draftSnap = await tx.get(draftDoc)
    const draft = draftSnap.exists() ? (draftSnap.data() as CheckSheetDraft) : null

    const plan = planDraftEdit(loaded, draft, pointerOf(applianceSnap.data() as Appliance | undefined), base, edit)
    switch (plan.kind) {
      case 'stale':
        throw new StaleEditor()
      case 'refused':
        throw new EditRefused(draft)
      case 'delete':
        tx.delete(draftDoc)
        return null
      case 'write': {
        const written = plain(plan.draft)
        tx.set(draftDoc, written)
        return written
      }
    }
  })
}

export async function publishDraft(slug: string, applianceId: string, loaded: LoadedState): Promise<void> {
  const appliance = applianceRef(slug, applianceId)
  const draftDoc = draftRef(slug, applianceId)
  await runTransaction(db, async (tx) => {
    const applianceSnap = await tx.get(appliance)
    const draftSnap = await tx.get(draftDoc)
    const draft = draftSnap.exists() ? (draftSnap.data() as CheckSheetDraft) : null

    const plan = planPublish(loaded, draft, pointerOf(applianceSnap.data() as Appliance | undefined))
    switch (plan.kind) {
      case 'stale':
        throw new StaleEditor()
      case 'replaced':
        throw new SheetReplaced()
      case 'invalid':
        throw new PublishInvalid(plan.problems, draft as CheckSheetDraft)
      case 'publish': {
        const published = draft as CheckSheetDraft
        const versionRef = doc(
          db,
          'brigades',
          slug,
          'appliances',
          applianceId,
          'checkSheetVersions',
          String(plan.version),
        )
        tx.set(versionRef, {
          version: plan.version,
          createdAt: serverTimestamp(),
          origin: published.origin,
          sections: published.sections,
        })
        tx.update(appliance, { currentCheckSheetVersion: plan.version })
        tx.delete(draftDoc)
      }
    }
  })
}

export async function discardDraft(slug: string, applianceId: string, loaded: LoadedState): Promise<void> {
  const draftDoc = draftRef(slug, applianceId)
  await runTransaction(db, async (tx) => {
    const draftSnap = await tx.get(draftDoc)
    const draft = draftSnap.exists() ? (draftSnap.data() as CheckSheetDraft) : null

    if (planDiscard(loaded, draft).kind === 'stale') throw new StaleEditor()
    tx.delete(draftDoc)
  })
}
