import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function canvasPixels(page: Page) {
  return page.locator('.universe-canvas canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('webgl2')!
    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    context.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels,
    )
    let bright = 0
    let colored = 0
    let checksum = 0
    for (let index = 0; index < pixels.length; index += 64) {
      const maximum = Math.max(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
      )
      const minimum = Math.min(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
      )
      if (maximum > 50) bright++
      if (maximum - minimum > 20) colored++
      checksum =
        (checksum + pixels[index] * (index + 1) + pixels[index + 2]) %
        2147483647
    }
    return { bright, colored, checksum }
  })
}

test('late catalog loading cannot override a newer camera navigation', async ({ page }) => {
  let resumeCatalog: () => void = () => undefined
  const catalogGate = new Promise<void>((resolve) => { resumeCatalog = resolve })
  await page.route('**/data/stars.json', async (route) => { await catalogGate; await route.continue() })
  try {
    await page.goto('/?object=exo%3ATRAPPIST-1%20e')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-map-context', 'unified')
    await page.getByRole('slider', { name: 'Map scale', exact: true }).evaluate((element) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, 3)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect.poll(async () => Number(await canvas.getAttribute('data-world-distance-pc'))).toBeCloseTo(1000, 0)
    resumeCatalog()
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-scene', 'solar-system')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect.poll(async () => Number(await canvas.getAttribute('data-world-distance-pc'))).toBeCloseTo(1000, 0)
  } finally { resumeCatalog() }
})

test('view links preserve orbital and map modes across reloads', async ({ page }) => {
  await page.goto('/?object=earth&view=orbit')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-view', 'orbit')
  await expect(page.getByRole('tab', { name: 'Orbit', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
  await expect(page).toHaveURL(/view=object/)
  await page.getByRole('tab', { name: '3D map', exact: true }).click()
  await expect(page).toHaveURL(/view=map/)
  await page.reload()
  await expect(canvas).toHaveAttribute('data-view', 'map')
  await expect(canvas).toHaveAttribute('data-scene', 'earth')
  await page.goto('/?object=milky-way&view=orbit')
  await expect(canvas).toHaveAttribute('data-view', 'object')
  await expect(page.getByRole('tab', { name: 'Orbit', exact: true })).toBeDisabled()
})

test('dialog shortcuts cannot move the camera and Escape closes focused search', async ({ page }) => {
  await page.goto('/?object=earth&view=object')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
  const distance = Number(await canvas.getAttribute('data-camera-distance'))
  await page.getByRole('button', { name: 'Data and image credits', exact: true }).click()
  await expect(page.locator('.sources-dialog')).toBeVisible()
  await page.keyboard.press('+')
  await page.keyboard.press('r')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  expect(Number(await canvas.getAttribute('data-camera-distance'))).toBeCloseTo(distance, 5)
  await page.keyboard.press('Escape')
  await expect(page.locator('.sources-dialog')).not.toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open object catalog', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search celestial objects' }).fill('Mars')
  await page.keyboard.press('Escape')
  await expect(page.locator('.catalog-sidebar')).not.toHaveClass(/\bopen\b/)
})

test('changing the scale slider mid-flight honors the latest absolute distance', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Map scale', exact: true })
  for (const exponent of [6, -2]) {
    await slider.evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, exponent)
    await expect(canvas).toHaveAttribute('data-flying', 'true')
  }
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect.poll(async () => Number(await canvas.getAttribute('data-world-distance-pc'))).toBeCloseTo(0.01, 5)
  await expect(canvas).toHaveAttribute('data-map-context', 'unified')
})

test('hidden tabs suspend rendering and resume without retained movement', async ({
  page,
}) => {
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page.getByRole('button', { name: 'Orbit camera', exact: true }).click()
  await page.keyboard.down('w')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const before = await canvas.evaluate((element) => ({
    ...(element as HTMLCanvasElement).dataset,
  }))
  const clock = await page.locator('.clock-time').textContent()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0
        const next = () => {
          if (++frames === 12) resolve()
          else requestAnimationFrame(next)
        }
        requestAnimationFrame(next)
      }),
  )
  await expect(canvas).toHaveAttribute('data-frame', before.frame)
  await expect(page.locator('.clock-time')).toHaveText(clock!)
  await page.keyboard.up('w')
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(canvas).not.toHaveAttribute('data-frame', before.frame)
  const originalPosition = before.worldCamera!.split(',').map(Number)
  const maximumDrift = await canvas.evaluate(
    (element, original) => new Promise<number>((resolve) => {
      let frames = 0
      let drift = 0
      const measure = () => {
        const position = (element as HTMLCanvasElement).dataset.worldCamera!.split(',').map(Number)
        drift = Math.max(drift, Math.hypot(...position.map((coordinate, index) => coordinate - original[index])))
        if (++frames === 12) resolve(drift)
        else requestAnimationFrame(measure)
      }
      requestAnimationFrame(measure)
    }),
    originalPosition,
  )
  expect(maximumDrift).toBeLessThanOrEqual(Math.hypot(...originalPosition) * Number.EPSILON * 32)
})

test('repeated inspection changes retain one live canvas and clean up map labels', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const original = await canvas.elementHandle()
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-view', 'object')
    expect(await page.locator('.celestial-label').count()).toBeLessThanOrEqual(
      5,
    )
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-map-context', 'unified')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveCount(1)
    expect(await original!.evaluate((element) => element.isConnected)).toBe(
      true,
    )
    expect(await page.locator('.celestial-label').count()).toBeLessThanOrEqual(
      22,
    )
    await expect(page.locator('.graphics-error')).toHaveCount(0)
  }
  expect((await canvasPixels(page)).colored).toBeGreaterThan(100)
  expect(errors).toEqual([])
})

test('an unavailable comet orbit cannot corrupt the camera when changing dates', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?object=sb%3A1001259')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(canvas).toHaveAttribute('data-scene', 'sb:1001259')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(canvas).toHaveAttribute(
    'data-active-model-ids',
    /(^|,)sb:1001259(,|$)/,
  )
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const position = await canvas.getAttribute('data-world-camera')
  await page.getByLabel('Simulation date').fill('1900-01-01')
  await expect(page.locator('.toast')).toContainText(
    'Orbit calculation unavailable',
  )
  await expect(canvas).toHaveAttribute('data-world-camera', position!)
  await expect(canvas).not.toHaveAttribute(
    'data-active-model-ids',
    /(^|,)sb:1001259(,|$)/,
  )
  await expect(page.locator('.graphics-error')).toHaveCount(0)
  const coordinates = await canvas.evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset
    return [
      ...data.worldCamera!.split(','),
      ...data.worldTarget!.split(','),
      data.worldDistancePc!,
    ].map(Number)
  })
  expect(coordinates.every(Number.isFinite)).toBe(true)
  await page.getByLabel('Simulation date').fill('2026-09-16')
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeLessThan(0.01)
  expect(errors).toEqual([])
})

test('catalog failures recover in place without corrupting the map', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let available = false
  let requests = 0
  await page.route('**/data/stars.json', async (route) => {
    requests++
    if (!available)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      })
    else await route.continue()
  })
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(
    page.getByRole('button', { name: 'Retry catalog loading', exact: true }),
  ).toBeVisible()
  expect(requests).toBe(2)
  await expect(canvas).toHaveAttribute('data-map-context', 'unified')
  await expect(page.locator('.graphics-error')).toHaveCount(0)
  const generation = await canvas.getAttribute('data-map-generation')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Search celestial objects' })
    .fill('Earth')
  await expect(
    page
      .locator('.catalog-scroll')
      .getByRole('button', { name: 'Earth', exact: true }),
  ).toBeVisible()
  available = true
  await page
    .getByRole('button', { name: 'Retry catalog loading', exact: true })
    .click()
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-map-objects')))
    .toBeGreaterThan(110000)
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  await expect(
    page.getByRole('textbox', { name: 'Search celestial objects' }),
  ).toHaveValue('Earth')
  await expect(
    page.getByRole('button', { name: 'Retry catalog loading', exact: true }),
  ).toHaveCount(0)
  expect(errors).toEqual([])
})

test('invalid catalog rows are rejected before any map data is published', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/data/stars.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ rows: [['invalid', null]] }),
    }),
  )
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(
    page.getByRole('button', { name: 'Retry catalog loading', exact: true }),
  ).toBeVisible()
  expect(Number(await canvas.getAttribute('data-map-objects'))).toBeLessThan(50)
  await expect(page.locator('.graphics-error')).toHaveCount(0)
  await page.unroute('**/data/stars.json')
  await page
    .getByRole('button', { name: 'Retry catalog loading', exact: true })
    .click()
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  expect(errors).toEqual([])
})

test('graphics recover after repeated context loss without resetting navigation', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?object=earth&view=object')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-loaded-assets', '4')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const generation = await canvas.getAttribute('data-map-generation')
  const camera = await canvas.getAttribute('data-camera-distance')
  for (let cycle = 0; cycle < 2; cycle++) {
    const supported = await canvas.evaluate((element) => {
      const surface = element as HTMLCanvasElement & {
        testContext?: WEBGL_lose_context
      }
      const extension = surface
        .getContext('webgl2')!
        .getExtension('WEBGL_lose_context')
      if (!extension) return false
      surface.testContext = extension
      extension.loseContext()
      return true
    })
    expect(supported).toBe(true)
    await expect(canvas).toHaveAttribute('data-graphics-state', 'lost')
    await expect(page.locator('.graphics-error')).toBeVisible()
    const stoppedFrame = await canvas.getAttribute('data-frame')
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await expect(canvas).toHaveAttribute('data-frame', stoppedFrame!)
    await canvas.evaluate((element) =>
      (
        element as HTMLCanvasElement & { testContext: WEBGL_lose_context }
      ).testContext.restoreContext(),
    )
    await expect(canvas).toHaveAttribute('data-graphics-state', 'ready')
    await expect(page.locator('.graphics-error')).toHaveCount(0)
    await expect(canvas).not.toHaveAttribute('data-frame', stoppedFrame!)
    await expect(canvas).toHaveAttribute('data-scene', 'earth')
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    await expect(canvas).toHaveAttribute('data-camera-distance', camera!)
    expect((await canvasPixels(page)).colored).toBeGreaterThan(500)
  }
  await expect(canvas).toHaveCount(1)
  expect(errors).toEqual([])
})

test('extreme zoom near distant objects keeps the camera finite and recoverable', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?object=ton618')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  for (const exponent of [-12, 10, -12]) {
    await page
      .getByRole('slider', { name: 'Map scale', exact: true })
      .evaluate((element, value) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }, exponent)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    const state = await canvas.evaluate((element) => {
      const data = (element as HTMLCanvasElement).dataset
      return {
        distance: Number(data.worldDistancePc),
        position: data.worldCamera!.split(',').map(Number),
        target: data.worldTarget!.split(',').map(Number),
      }
    })
    expect(state.distance).toBeGreaterThan(0)
    expect(
      [state.distance, ...state.position, ...state.target].every(
        Number.isFinite,
      ),
    ).toBe(true)
    await expect(page.locator('.graphics-error')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeLessThan(0.01)
  await expect(page.locator('.universe-canvas canvas')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('Earth has loaded surface maps and a live, interactive 3D canvas', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?object=earth&view=object')
  await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
    'data-frame',
    /\d+/,
  )
  await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
    'data-loaded-assets',
    '4',
  )
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page.getByLabel('Simulation date').fill('2026-09-16')
  await expect
    .poll(() =>
      page
        .locator('.universe-canvas canvas')
        .getAttribute('data-camera-distance'),
    )
    .toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('desktop-earth.png') })
  const pixels = await canvasPixels(page)
  expect(pixels.bright).toBeGreaterThan(2000)
  expect(pixels.colored).toBeGreaterThan(1000)
  const targetBeforePan = await page
    .locator('.universe-canvas canvas')
    .getAttribute('data-camera-target')
  await page.mouse.move(690, 450)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(750, 470, { steps: 12 })
  await page.mouse.up({ button: 'right' })
  await expect(page.locator('.universe-canvas canvas')).not.toHaveAttribute(
    'data-camera-target',
    targetBeforePan!,
  )
  const initialDistance = Number(
    await page
      .locator('.universe-canvas canvas')
      .getAttribute('data-camera-distance'),
  )
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.universe-canvas canvas')
          .getAttribute('data-camera-distance'),
      ),
    )
    .toBeLessThan(initialDistance * 0.9)
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  expect(errors).toEqual([])
  await expect
    .poll(() =>
      page
        .locator('img:visible')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true)
})

test('the 3D map keeps planets in one scene during smooth travel', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-map-context', 'unified')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-map-objects')))
    .toBeGreaterThan(8000)
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page.screenshot({ path: testInfo.outputPath('solar-system-map.png') })
  const generation = await canvas.getAttribute('data-map-generation')
  const initialTarget = await canvas.getAttribute('data-camera-target')
  await page.getByRole('button', { name: 'Orbit camera', exact: true }).click()
  await page.keyboard.down('w')
  await expect(canvas).not.toHaveAttribute('data-camera-target', initialTarget!)
  await page.keyboard.up('w')
  await page.getByRole('button', { name: 'Pan map', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-navigation', 'pan')
  await page.getByRole('button', { name: 'Orbit camera', exact: true }).click()
  await page
    .locator('.catalog-scroll')
    .getByRole('button', { name: 'Earth', exact: true })
    .click()
  await expect(canvas).toHaveAttribute('data-scene', 'earth')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  const earthTarget = await canvas.getAttribute('data-camera-target')
  await page
    .locator('.catalog-scroll')
    .getByRole('button', { name: 'Saturn', exact: true })
    .click()
  await expect(canvas).toHaveAttribute('data-scene', 'saturn')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(canvas).toHaveAttribute(
    'data-active-model-ids',
    /(^|,)saturn(,|$)/,
  )
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  await expect(canvas).not.toHaveAttribute('data-camera-target', earthTarget!)
  await expect
    .poll(async () => (await canvasPixels(page)).bright)
    .toBeGreaterThan(500)
  await page.screenshot({ path: testInfo.outputPath('saturn-in-map.png') })
  await page
    .getByRole('textbox', { name: 'Search celestial objects' })
    .fill('Pluto')
  await page
    .locator('.catalog-scroll')
    .getByRole('button', { name: '134340 Pluto (1930 BM)', exact: true })
    .click()
  await expect(page.locator('.scene-heading h1')).toHaveText(
    '134340 Pluto (1930 BM)',
  )
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  expect(errors).toEqual([])
})

test('continuous world zoom crosses astronomical scales without selecting anything', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-map-objects')))
    .toBeGreaterThan(110000)
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const generation = await canvas.getAttribute('data-map-generation')
  const selected = await canvas.getAttribute('data-scene')
  await page.mouse.move(680, 480)
  for (let index = 0; index < 11; index++) await page.mouse.wheel(0, 1000)
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeGreaterThan(10000)
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(canvas).toHaveAttribute('data-map-context', 'unified')
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  await expect(canvas).toHaveAttribute('data-scene', selected!)
  expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
  await page.screenshot({
    path: testInfo.outputPath('continuous-galactic-scale.png'),
  })
  for (let index = 0; index < 8; index++) await page.mouse.wheel(0, -1000)
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeLessThan(1)
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  expect(errors).toEqual([])
})

test('approaching a planet loads its surface without a selection or jump', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const generation = await canvas.getAttribute('data-map-generation')
  const scale = page.getByRole('slider', { name: 'Map scale', exact: true })
  await scale.evaluate((element) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, Math.log10(8 / 206264.80624709636))
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  for (let step = 0; step < 8; step++) {
    if (
      (await canvas.getAttribute('data-active-model-ids'))
        ?.split(',')
        .includes('earth')
    )
      break
    const earth = page.locator('.celestial-label[data-world-id="earth"]')
    await expect(earth).toBeVisible()
    await earth.hover()
    await page.mouse.wheel(0, -950)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
  }
  await expect(canvas).toHaveAttribute(
    'data-active-model-ids',
    /(^|,)earth(,|$)/,
  )
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -700)
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(page.locator('.scene-heading h1')).toHaveText('Earth')
  await expect(page.locator('.object-identity h2')).toHaveText('Earth')
  expect((await canvasPixels(page)).colored).toBeGreaterThan(400)
  await expect(canvas).toHaveAttribute('data-scene', 'solar-system')
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  await page.screenshot({
    path: testInfo.outputPath('earth-approached-without-selection.png'),
  })
})

test('detailed galaxy, black hole, stars, and catalog destinations render', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  for (const [query, name] of [
    ['Milky Way', 'Milky Way'],
    ['Sagittarius A*', 'Sagittarius A*'],
    ['Stellar Neighborhood', 'Stellar Neighborhood'],
    ['1P/Halley', '1P/Halley'],
    ['TRAPPIST-1 e', 'TRAPPIST-1 e'],
  ]) {
    await page
      .getByRole('textbox', { name: 'Search celestial objects' })
      .fill(query)
    await expect(
      page
        .locator('.catalog-scroll')
        .getByRole('button', { name, exact: true }),
    ).toBeVisible({ timeout: 10000 })
    await page
      .locator('.catalog-scroll')
      .getByRole('button', { name, exact: true })
      .click()
    await expect(page.locator('.scene-heading h1')).toHaveText(name)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    expect((await canvasPixels(page)).bright, name).toBeGreaterThan(100)
    await page.screenshot({
      path: testInfo.outputPath(`${name.replace(/[^a-z0-9]/gi, '-')}.png`),
    })
    expect(errors, name).toEqual([])
  }
})

test('reference detail stays visible while orbiting and zooming on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    for (const id of ['milky-way', 'sagittarius-a']) {
      await page.goto(`/?object=${id}&view=object`)
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-scene', id)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      if (id === 'milky-way') {
        await expect(canvas).toHaveAttribute(
          'data-galaxy-texture-ready',
          'true',
        )
        await expect
          .poll(async () =>
            Number(await canvas.getAttribute('data-galaxy-particles')),
          )
          .toBeGreaterThan(100000)
      }
      await page
        .getByRole('button', { name: 'Pause simulation', exact: true })
        .click()
      const pixels = await canvasPixels(page)
      expect(pixels.bright, `${id} ${viewport.width}`).toBeGreaterThan(
        viewport.width > 760 ? 1000 : 100,
      )
      expect(pixels.colored, `${id} ${viewport.width}`).toBeGreaterThan(
        viewport.width > 760 ? 300 : 40,
      )
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}.png`),
      })
      const start = await canvas.getAttribute('data-camera-distance')
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect
        .poll(async () =>
          Number(await canvas.getAttribute('data-camera-distance')),
        )
        .toBeLessThan(Number(start) * 0.9)
      const horizontal = viewport.width > 760 ? 700 : 170
      const vertical = viewport.width > 760 ? 490 : 390
      await page.mouse.move(horizontal, vertical)
      await page.mouse.down()
      await page.mouse.move(horizontal + 65, vertical + 34, { steps: 12 })
      await page.mouse.up()
      await expect
        .poll(async () => (await canvasPixels(page)).checksum)
        .not.toBe(pixels.checksum)
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}-oblique.png`),
      })
      if (id === 'sagittarius-a') {
        const pausedPixels = await canvasPixels(page)
        await page
          .getByRole('button', { name: 'Play simulation', exact: true })
          .click()
        await expect
          .poll(async () => (await canvasPixels(page)).checksum)
          .not.toBe(pausedPixels.checksum)
      }
      expect(errors).toEqual([])
    }
  }
})

test('phone navigation crosses scales without changing the selected destination', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const generation = await canvas.getAttribute('data-map-generation')
  const selected = await canvas.getAttribute('data-scene')
  for (const distancePc of [40000, 8 / 206264.80624709636]) {
    await page
      .getByRole('slider', { name: 'Map scale', exact: true })
      .evaluate((element, distance) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(element, Math.log10(distance))
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }, distancePc)
    await expect
      .poll(async () =>
        Math.abs(
          Math.log10(
            Number(await canvas.getAttribute('data-world-distance-pc')),
          ) - Math.log10(distancePc),
        ),
      )
      .toBeLessThan(0.06)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    await expect(canvas).toHaveAttribute('data-scene', selected!)
    expect((await canvasPixels(page)).bright).toBeGreaterThan(50)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(
        distancePc > 1
          ? 'mobile-continuous-galaxy.png'
          : 'mobile-continuous-solar.png',
      ),
    })
  }
})

test('responsive map stays framed and usable on phones', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?object=earth')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    expect((await canvasPixels(page)).colored).toBeGreaterThan(100)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(
      await page
        .locator('.scene-mode')
        .evaluate((element) =>
          [...element.children]
            .filter((child) => getComputedStyle(child).display !== 'none')
            .every(
              (child) => child.getBoundingClientRect().right <= innerWidth,
            ),
        ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`mobile-earth-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Open object catalog', exact: true })
      .click()
    await page
      .getByRole('textbox', { name: 'Search celestial objects' })
      .fill('1P/Halley')
    await page
      .locator('.catalog-scroll')
      .getByRole('button', { name: '1P/Halley', exact: true })
      .click()
    await expect(page.locator('.scene-heading h1')).toHaveText('1P/Halley')
    await page
      .getByRole('button', { name: 'Show details for 1P/Halley' })
      .click()
    await expect(page.locator('.object-inspector')).toHaveClass(
      /mobile-expanded/,
    )
    await page.getByRole('tab', { name: 'Orbital data', exact: true }).click()
    await expect(page.locator('.orbit-data-table')).toContainText('Sun')
    await page
      .getByRole('button', { name: 'Close object details', exact: true })
      .click()
  }
})

test('imported bookmarks, orbital motion, layers, and image export work', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Search celestial objects' })
    .fill('TRAPPIST-1 e')
  await page
    .locator('.catalog-scroll')
    .getByRole('button', { name: 'TRAPPIST-1 e', exact: true })
    .click()
  await page.getByRole('button', { name: 'Save object', exact: true }).click()
  await page
    .getByRole('button', { name: 'Saved destinations', exact: true })
    .click()
  await expect(page.locator('.saved-list')).toContainText('TRAPPIST-1 e')
  await page.reload()
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Saved destinations', exact: true })
    .click()
  await expect(page.locator('.saved-list')).toContainText('TRAPPIST-1 e')
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Search celestial objects' })
    .fill('Earth')
  await page
    .locator('.catalog-scroll')
    .getByRole('button', { name: 'Earth', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  if (
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .isVisible()
  )
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
  await page.getByLabel('Simulation date').fill('2026-01-01')
  const first = (await canvasPixels(page)).checksum
  await page.getByLabel('Simulation date').fill('2026-07-01')
  await expect
    .poll(async () => (await canvasPixels(page)).checksum)
    .not.toBe(first)
  await page.getByRole('switch', { name: 'Labels', exact: true }).click()
  await expect(page.locator('.celestial-label:visible')).toHaveCount(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Capture image', exact: true }).click()
  expect((await download).suggestedFilename()).toContain('atlas-earth')
})
