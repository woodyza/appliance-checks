import type { Locator, Page } from '@playwright/test'
import { e2eEnv } from './env'
import { expect, test } from './fixtures'
import { BRIGADE_ADMIN_EMAIL, signIn, SUPERADMIN_EMAIL, VSO_EMAIL } from './signIn'

// Signs in as users seeded by `e2e-seed` on the emulator only, and there's no inbox to read against dev.
test.skip(e2eEnv() === 'dev', 'no readable inbox against dev')

const HEIGHT = 800
const HOME: Record<string, string> = {
  [SUPERADMIN_EMAIL]: '/admin',
  [VSO_EMAIL]: '/admin/brigades',
  [BRIGADE_ADMIN_EMAIL]: '/e2etst/admin',
}

async function signInAt(page: Page, email: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: HEIGHT })
  await signIn(page, email)
  await expect(page).toHaveURL(HOME[email])
}

function sidebar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Admin', exact: true })
}

test('a Superadmin sees Users and Brigades in the sidebar', async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1440)

  await expect(sidebar(page).getByRole('link')).toHaveText(['Users', 'Brigades'])
})

test('a VSO sees Brigades but not Users in the sidebar', async ({ page }) => {
  await signInAt(page, VSO_EMAIL, 1440)

  await expect(sidebar(page).getByRole('link')).toHaveText(['Brigades'])
})

test("a Brigade Admin sees only their brigade's group, with the Overview highlighted", async ({ page }) => {
  await signInAt(page, BRIGADE_ADMIN_EMAIL, 1440)

  await expect(sidebar(page).locator('.nav-brigade')).toHaveText('E2E Test Brigade')
  await expect(sidebar(page).getByRole('link')).toHaveText(['Overview', 'E2E 1', 'E2E 2', 'E2E 3'])
  await expect(sidebar(page).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
})

test('clicking a sibling appliance in the tree opens its editor, highlighted', async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1440)
  await page.goto('/e2etst/admin/e2e1')
  await expect(sidebar(page).getByRole('link', { name: 'E2E 1' })).toHaveAttribute('aria-current', 'page')

  await sidebar(page).getByRole('link', { name: 'E2E 2' }).click()

  await expect(page).toHaveURL('/e2etst/admin/e2e2')
  await expect(sidebar(page).getByRole('link', { name: 'E2E 2' })).toHaveAttribute('aria-current', 'page')
})

test('deactivating and renaming an appliance updates the tree without a reload', async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1440)
  await page.goto('/e2eedt/admin/e2ed7')
  const toggle = page.locator('.active-toggle')
  const callsign = page.locator('.callsign-input')
  const entry = (name: string): Locator => sidebar(page).getByRole('link', { name })
  await expect(entry('E2E D7')).toBeVisible()

  try {
    page.once('dialog', (dialog) => void dialog.accept())
    await toggle.uncheck()
    await expect(entry('E2E D7 (inactive)')).toHaveClass(/nav-inactive/)

    await callsign.fill('E2E D7 renamed')
    await callsign.press('Tab')
    await expect(entry('E2E D7 renamed (inactive)')).toBeVisible()
  } finally {
    await callsign.fill('E2E D7')
    await callsign.press('Tab')
    await expect(entry('E2E D7 (inactive)')).toBeVisible()
    await toggle.check()
    await expect(entry('E2E D7')).not.toHaveClass(/nav-inactive/)
    await expect(toggle).toBeEnabled()
  }
})

test('at 1100px the menu opens the nav overlay, Esc closes it and a tree link navigates', async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1100)
  await page.goto('/e2etst/admin/e2e1')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const overlay = page.locator('dialog.nav-overlay')

  await expect(page.locator('.nav-rail')).toBeVisible()
  await expect(page.locator('.nav-sidebar')).toBeHidden()

  await menu.click()
  await expect(overlay).toBeVisible()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')

  await menu.click()
  await overlay.getByRole('link', { name: 'E2E 2' }).click()
  await expect(page).toHaveURL('/e2etst/admin/e2e2')
  await expect(overlay).toBeHidden()
})

test('at 1100px a click outside the sidebar closes the nav overlay', async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1100)
  const overlay = page.locator('dialog.nav-overlay')

  const menu = page.getByRole('button', { name: 'Menu', exact: true })

  await menu.click()
  await expect(overlay).toBeVisible()
  await overlay.click({ position: { x: 700, y: 400 } })

  await expect(overlay).toBeHidden()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
})

test("at 1100px a tree link to the page you're on closes the nav overlay", async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1100)
  await page.goto('/e2etst/admin')
  const overlay = page.locator('dialog.nav-overlay')

  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await overlay.getByRole('link', { name: 'Overview' }).click()

  await expect(overlay).toBeHidden()
  await expect(page).toHaveURL('/e2etst/admin')
})

for (const width of [900, 1000, 1100, 1280]) {
  test(`the editor at ${width}px keeps Sections beside the table and the rows inside it`, async ({ page }) => {
    await signInAt(page, SUPERADMIN_EMAIL, width)
    await page.goto('/e2eedt/admin/e2ed1')
    await expect(page.locator('.sheet-section').first()).toBeVisible()

    const sections = await page.locator('.editor-sidebar').boundingBox()
    const table = await page.locator('.sheet-section').first().boundingBox()
    expect(sections).not.toBeNull()
    expect(table).not.toBeNull()
    expect(sections!.x + sections!.width).toBeLessThanOrEqual(table!.x)

    const overflowing = await page.locator('.sheet-row').evaluateAll((rows) =>
      rows.filter((row) => {
        const limit = row.closest('.sheet-rows')!.getBoundingClientRect().right + 0.5
        return [...row.children].some((cell) => cell.getBoundingClientRect().right > limit)
      }).length,
    )
    expect(overflowing).toBe(0)
  })
}

for (const width of [900, 1000]) {
  test(`the editor has compact rows at ${width}px`, async ({ page }) => {
    await signInAt(page, SUPERADMIN_EMAIL, width)
    await page.goto('/e2eedt/admin/e2ed1')

    await expect(page.locator('.sheet-section').first()).toBeVisible()
    await expect(page.locator('.sheet-head').first()).toBeHidden()
  })
}

for (const width of [1100, 1280]) {
  test(`the editor has full rows at ${width}px`, async ({ page }) => {
    await signInAt(page, SUPERADMIN_EMAIL, width)
    await page.goto('/e2eedt/admin/e2ed1')

    await expect(page.locator('.sheet-head').first()).toBeVisible()
  })
}

test('on a wide screen the Overview content stays within a 48rem column', async ({ page }) => {
  await signInAt(page, BRIGADE_ADMIN_EMAIL, 2560)

  const panel = page.locator('.admin-panel').first()
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(768)
  expect(box!.x + box!.width / 2).toBeCloseTo((2560 - 224) / 2 + 224, -1)
})

test('on a wide screen the Checks screen is a centred column of at most 40rem', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: HEIGHT })
  await page.goto('/e2etst')
  await expect(page.locator('.appliance-card').first()).toBeVisible()

  const box = await page.locator('#app').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(640)
  expect(box!.x + box!.width / 2).toBeCloseTo(1280, 0)
})

test('signing out from the top bar returns to the sign-in page', async ({ page }) => {
  await signInAt(page, SUPERADMIN_EMAIL, 1440)

  await page.locator('.shell-topbar').getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL('/admin/sign-in')
})
