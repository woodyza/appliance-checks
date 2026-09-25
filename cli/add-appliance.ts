import { parseArgs } from 'node:util'
import { addAppliance } from './lib/store'
import { hostingBaseUrl, parseProjectTarget, resolveTarget } from './lib/target'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brigade: { type: 'string' },
      id: { type: 'string' },
      callsign: { type: 'string' },
      project: { type: 'string' },
    },
  })

  if (!values.brigade) throw new Error('--brigade is required.')
  if (!values.id) throw new Error('--id is required.')
  if (!/^[A-Za-z0-9_-]+$/.test(values.id)) {
    throw new Error('--id must contain only letters, digits, "-" and "_" (it becomes part of the QR URL).')
  }
  if (!values.callsign) throw new Error('--callsign is required.')

  const target = parseProjectTarget(values.project)
  const db = await resolveTarget(target)
  await addAppliance(db, values.brigade, { id: values.id, callsign: values.callsign })

  console.log(`Appliance added: ${values.callsign} (${values.id})`)
  console.log(`QR URL: ${hostingBaseUrl(target)}/${values.brigade}/${values.id}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
