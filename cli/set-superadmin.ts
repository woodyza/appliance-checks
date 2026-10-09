import { parseArgs } from 'node:util'
import { isValidEmail } from '../src/domain/adminUser'
import { setSuperadmin } from './lib/store'
import { adminAuth, readProjectId, resolveTarget } from './lib/target'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { project: { type: 'string' }, email: { type: 'string' } } })

  const project = values.project
  if (project !== 'dev' && project !== 'prod') throw new Error('--project must be dev or prod.')
  const email = values.email?.trim().toLowerCase()
  if (!email) throw new Error('--email is required.')
  if (!isValidEmail(email)) throw new Error(`--email "${email}" is not a valid email address.`)

  // Admin SDK Auth calls made with user (gcloud ADC) credentials need a quota project, unlike
  // Firestore; firebase-admin reads this on every request.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= readProjectId(project)
  const db = await resolveTarget(project)
  const user = await adminAuth()
    .getUserByEmail(email)
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === 'auth/user-not-found') {
        throw new Error(`No Auth account for ${email}: sign in at /admin/sign-in first, then re-run.`, { cause: error })
      }
      throw error
    })
  const { before, after } = await setSuperadmin(db, { uid: user.uid, email })

  console.log(`Superadmin on ${project}`)
  console.log(`  before: ${JSON.stringify(before)}`)
  console.log(`  after:  ${JSON.stringify(after)}`)
  console.log(`\nThe rules and the build only pick this up on the next \`make deploy ENV=${project}\`.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
