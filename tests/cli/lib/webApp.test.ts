import { describe, expect, it } from 'vitest'
import { sheetsWebReferrers } from '../../../cli/lib/webApp'

describe('sheetsWebReferrers', () => {
  it('allows the hosting origins and the Vite dev server on dev', () => {
    expect(sheetsWebReferrers('dev', 'my-proj')).toEqual([
      'https://my-proj.web.app/*',
      'https://my-proj.firebaseapp.com/*',
      'http://localhost:5173/*',
    ])
  })

  it('allows only the hosting origins on prod', () => {
    expect(sheetsWebReferrers('prod', 'my-proj')).toEqual([
      'https://my-proj.web.app/*',
      'https://my-proj.firebaseapp.com/*',
    ])
  })
})
