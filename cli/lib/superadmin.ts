import { gcloudAccessToken } from './accounts'

export const SUPERADMIN_COLLECTION = 'deployConfig'
export const SUPERADMIN_DOC = 'superadmin'

// A missing doc is the only case that means "no superadmin yet": any other failure must stop the
// deploy, since treating it as missing would deploy rules that lock the superadmin out.
export function superadminUidFromResponse(status: number, body: string): string | undefined {
  if (status === 404) return undefined
  if (status !== 200) throw new Error(`Could not read ${SUPERADMIN_COLLECTION}/${SUPERADMIN_DOC} (${String(status)}): ${body}`)
  const uid = (JSON.parse(body) as { fields?: { uid?: { stringValue?: string } } }).fields?.uid?.stringValue
  if (!uid) throw new Error(`${SUPERADMIN_COLLECTION}/${SUPERADMIN_DOC} has no uid.`)
  return uid
}

export async function readSuperadminUid(projectId: string): Promise<string | undefined> {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${SUPERADMIN_COLLECTION}/${SUPERADMIN_DOC}`,
    { headers: { Authorization: `Bearer ${gcloudAccessToken()}`, 'x-goog-user-project': projectId } },
  )
  return superadminUidFromResponse(response.status, await response.text())
}
