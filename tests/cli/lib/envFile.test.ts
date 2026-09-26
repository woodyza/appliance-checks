import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readEnvFile, renderEnvFile } from '../../../cli/lib/envFile'

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('readEnvFile', () => {
  it('parses KEY=value lines, skipping comments and blank lines, keeping "=" inside values', () => {
    dir = mkdtempSync(join(tmpdir(), 'envfile-'))
    const path = join(dir, '.env.dev')
    const contents = [
      '# a comment',
      '',
      'VITE_FIREBASE_API_KEY=abc123',
      'VITE_RECAPTCHA_SITE_KEY=key==with==equals',
      '  ',
    ].join('\n')
    writeFileSync(path, contents)

    expect(readEnvFile(path)).toEqual({
      VITE_FIREBASE_API_KEY: 'abc123',
      VITE_RECAPTCHA_SITE_KEY: 'key==with==equals',
    })
  })

  it('returns null when the file does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'envfile-'))
    expect(readEnvFile(join(dir, 'missing.env'))).toBe(null)
  })
})

describe('renderEnvFile', () => {
  it('renders values that read back the same via readEnvFile', () => {
    dir = mkdtempSync(join(tmpdir(), 'envfile-'))
    const path = join(dir, '.env.dev')
    const values = { VITE_FIREBASE_PROJECT_ID: 'appliance-checks-dev', VITE_RECAPTCHA_SITE_KEY: 'a==b' }

    writeFileSync(path, renderEnvFile(values))

    expect(readEnvFile(path)).toEqual(values)
  })
})
