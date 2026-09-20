import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { atlasExperiences } from '../src/data/experiences'

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`radio exposure lifts faint emission without changing other bands at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('./?object=crab&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const visible = await canvasPixels(page)
    const band = page.getByRole('combobox', { name: 'Observation spectrum' })
    await band.selectOption('radio')
    const exposure = page.getByRole('slider', { name: 'Radio exposure' })
    await expect(exposure).toHaveValue('3')
    await exposure.fill('1')
    const low = await canvasPixels(page)
    await exposure.fill('3')
    await expect
      .poll(async () => (await canvasPixels(page)).bright)
      .toBeGreaterThan(low.bright * 1.15)
    const brighter = await canvasPixels(page)
    expect(brighter.clipped / Math.max(1, brighter.bright)).toBeLessThan(0.12)
    await page.screenshot({
      path: testInfo.outputPath(`radio-exposure-${viewport.width}.png`),
    })
    await band.selectOption('visible')
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .toBe(visible.checksum)
    await expect(exposure).toHaveCount(0)
    await page.goto('./?object=bootes-void&view=object')
    await page
      .getByRole('combobox', { name: 'Observation spectrum' })
      .selectOption('radio')
    await page.getByRole('slider', { name: 'Radio exposure' }).fill('8')
    expect((await canvasPixels(page)).bright).toBe(0)
  })
}

test('camera returns to full quality at a low frame rate', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    const pending = new Map<number, number>()
    let serial = 0
    let last = 0
    window.requestAnimationFrame = (callback) => {
      const id = ++serial
      const tick = (now: number) => {
        if (now - last < 500) pending.set(id, request(tick))
        else {
          pending.delete(id)
          last = now
          callback(now)
        }
      }
      pending.set(id, request(tick))
      return id
    }
    window.cancelAnimationFrame = (id) => {
      const frame = pending.get(id)
      if (frame !== undefined) cancel(frame)
      pending.delete(id)
    }
  })
  await page.goto('./?object=earth&view=object')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const before = await canvasPixels(page)
  await page.mouse.move(650, 500)
  await page.mouse.down()
  await expect(canvas).toHaveAttribute('data-render-quality', 'navigation')
  await page.mouse.move(750, 450, { steps: 4 })
  await page.mouse.up()
  await expect(canvas).toHaveAttribute('data-render-quality', 'full', {
    timeout: 10_000,
  })
  expect((await canvasPixels(page)).checksum).not.toBe(before.checksum)
})

async function canvasPixels(page: Page) {
  await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
    'data-render-quality',
    'full',
  )
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '.universe-canvas canvas',
    )!
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
    let clipped = 0
    let redLight = 0
    let blueLight = 0
    let warmStars = 0
    let coolStars = 0
    let pinkRegions = 0
    let sharpDetail = 0
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
      if (maximum > 50) {
        bright++
        redLight += pixels[index]
        blueLight += pixels[index + 2]
        if (pixels[index] > pixels[index + 2] * 1.08) warmStars++
        if (pixels[index + 2] > pixels[index] * 1.08) coolStars++
        if (
          pixels[index] > pixels[index + 1] * 1.12 &&
          pixels[index + 2] > pixels[index + 1] * 1.05
        )
          pinkRegions++
        if (
          index + 6 < pixels.length &&
          Math.abs(
            maximum -
              Math.max(pixels[index + 4], pixels[index + 5], pixels[index + 6]),
          ) > 18
        )
          sharpDetail++
      }
      if (maximum - minimum > 20) colored++
      if (minimum > 240) clipped++
      checksum =
        (checksum + pixels[index] * (index + 1) + pixels[index + 2]) %
        2147483647
    }
    return {
      bright,
      colored,
      clipped,
      checksum,
      blueRedRatio: blueLight / Math.max(1, redLight),
      warmStars,
      coolStars,
      pinkRegions,
      sharpDetail,
    }
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`mission histories and detailed Saturn moons render at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150000)
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204 }),
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    for (const id of ['saturn', 'titan', 'enceladus', 'new-horizons']) {
      await page.goto(`./?object=${id}&view=object`)
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      if (id === 'new-horizons')
        await expect(canvas).toHaveAttribute('data-model-state', 'ready')
      if (id === 'saturn')
        await expect(canvas).toHaveAttribute(
          'data-saturn-shadows',
          'planet-and-rings',
        )
      expect((await canvasPixels(page)).bright).toBeGreaterThan(
        viewport.width > 760 ? 100 : 15,
      )
      await page.screenshot({
        path: testInfo.outputPath(`${id}-detailed-${viewport.width}.png`),
      })
    }
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    const tools = page.getByRole('region', { name: 'Exploration tools' })
    await tools.getByRole('tab', { name: 'Missions' }).click()
    await tools
      .getByRole('combobox', { name: 'Spacecraft', exact: true })
      .selectOption('new-horizons')
    await tools.getByRole('button', { name: /Pluto flyby/ }).click()
    await expect(
      page.getByRole('textbox', { name: 'Simulation date' }),
    ).toHaveValue('2015-07-14')
    await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
      'data-view',
      'orbit',
    )
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
      'data-following-id',
      'new-horizons',
    )
    await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
      'data-flying',
      'false',
    )
    expect(errors).toEqual([])
  })
}

test('saved and shared viewpoints restore camera date and layers', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }))
  await page.goto('./?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page.getByRole('switch', { name: 'Labels', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Simulation date' })
    .fill('2027-03-15')
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  const camera = (await canvas.getAttribute('data-world-camera'))!
    .split(',')
    .map(Number)
  const target = (await canvas.getAttribute('data-world-target'))!
    .split(',')
    .map(Number)
  await page.getByRole('combobox', { name: 'Observation spectrum' }).selectOption('infrared')
  await page
    .getByRole('button', { name: 'Exploration tools', exact: true })
    .click()
  const tools = page.getByRole('region', { name: 'Exploration tools' })
  await tools.getByLabel('Viewpoint name').fill('Earth test')
  await tools.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(
    tools.getByRole('button', { name: 'Restore Earth test' }),
  ).toBeVisible()
  await tools.getByRole('button', { name: 'Share view', exact: true }).click()
  const link = await tools.getByLabel('Share link').inputValue()
  expect(link).toContain('#view=')
  await page.goto('about:blank')
  await page.goto(link)
  await expect(canvas).toHaveAttribute('data-viewpoint-applied', 'Earth test')
  await expect(canvas).toHaveAttribute('data-observation-band', 'infrared')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(
    page.getByRole('textbox', { name: 'Simulation date' }),
  ).toHaveValue('2027-03-15')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(
    page.getByRole('switch', { name: 'Labels', exact: true }),
  ).toHaveAttribute('aria-checked', 'false')
  const restored = (await canvas.getAttribute('data-world-camera'))!
    .split(',')
    .map(Number)
  restored.forEach((coordinate, index) =>
    expect(coordinate).toBeCloseTo(camera[index], 12),
  )
  const restoredTarget = (await canvas.getAttribute('data-world-target'))!
    .split(',')
    .map(Number)
  restoredTarget.forEach((coordinate, index) =>
    expect(coordinate).toBeCloseTo(target[index], 12),
  )
  await page
    .getByRole('button', { name: 'Exploration tools', exact: true })
    .click()
  await expect(
    tools.getByRole('button', { name: 'Restore Earth test' }),
  ).toBeVisible()
  await tools.getByRole('button', { name: 'Delete Earth test' }).click()
  await expect(
    tools.getByRole('button', { name: 'Restore Earth test' }),
  ).toHaveCount(0)
})

test('shared science views preserve compared objects and observer location', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }))
  await page.goto('./?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  for (const mode of ['compare', 'sky']) {
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    const tools = page.getByRole('region', { name: 'Exploration tools' })
    if (mode === 'compare') {
      await tools.getByRole('tab', { name: 'Scale', exact: true }).click()
      await tools
        .getByRole('combobox', { name: 'Body 1', exact: true })
        .selectOption('gaia-bh1')
      await tools
        .getByRole('button', { name: 'Show comparison', exact: true })
        .click()
    } else {
      await tools.getByRole('tab', { name: 'Sky', exact: true }).click()
      await tools
        .getByRole('combobox', { name: 'Location preset' })
        .selectOption('Sydney')
      await tools
        .getByRole('button', { name: 'Observe sky', exact: true })
        .click()
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    }
    await expect(canvas).toHaveAttribute('data-view', mode)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    await tools.getByRole('tab', { name: 'Views', exact: true }).click()
    await tools.getByRole('button', { name: 'Share view', exact: true }).click()
    const link = await tools.getByLabel('Share link').inputValue()
    await page.goto('about:blank')
    await page.goto(link)
    await expect(canvas).toHaveAttribute('data-viewpoint-applied')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-view', mode)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    if (mode === 'compare')
      await expect(canvas).toHaveAttribute('data-comparison-radii', /gaia-bh1/)
    else {
      await expect(canvas).toHaveAttribute('data-sky-site', '-33.8688,151.2093')
      expect(Number(await canvas.getAttribute('data-camera-fov'))).toBeLessThan(
        65,
      )
    }
  }
})

test('lunar eclipse and Mercury transit replay use calculated disks and contact times', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('./?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
  for (const kind of ['lunar', 'transit']) {
    await page.getByRole('button', { name: 'Exploration tools', exact: true }).click()
    const tools = page.getByRole('region', { name: 'Exploration tools' })
    await tools.getByRole('tab', { name: 'Events', exact: true }).click()
    await tools.getByRole('combobox', { name: 'Location preset' }).selectOption('Greenwich')
    if (kind === 'lunar') {
      await tools.getByRole('spinbutton', { name: 'Latitude (deg)' }).fill('34.0522')
      await tools.getByRole('spinbutton', { name: 'Longitude (deg)' }).fill('-118.2437')
    }
    await page.getByRole('textbox', { name: 'Simulation date' }).fill(kind === 'lunar' ? '2022-11-01' : '2019-11-01')
    await tools.getByRole('button', { name: 'Find next events', exact: true }).click()
    await tools.getByRole('button', { name: kind === 'lunar' ? /total lunar eclipse.*2022-11-08/ : /Mercury transit.*2019-11-11/ }).click()
    await expect(canvas).toHaveAttribute('data-view', 'sky')
    await expect(canvas).toHaveAttribute('data-sky-focus', kind === 'lunar' ? 'Moon' : 'Sun')
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    if (kind === 'lunar') expect(Number(await canvas.getAttribute('data-lunar-umbra'))).toBeGreaterThan(0.005)
    const radii = JSON.parse((await canvas.getAttribute('data-sky-angular-radii'))!) as { body: string; radians: number }[]
    if (kind === 'transit') {
      const ratio = radii.find((body) => body.body === 'Mercury')!.radians / radii.find((body) => body.body === 'Sun')!.radians
      expect(ratio).toBeGreaterThan(0.001)
      expect(ratio).toBeLessThan(0.02)
    }
    expect((await canvasPixels(page)).bright).toBeGreaterThan(20)
    await page.screenshot({ path: testInfo.outputPath(`${kind}-peak.png`) })
    const peak = Number(await canvas.getAttribute('data-simulation-time'))
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await page.getByRole('button', { name: 'Exploration tools', exact: true }).click()
    await tools.getByRole('tab', { name: 'Events', exact: true }).click()
    await tools.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-view', 'sky')
    await expect.poll(async () => Number(await canvas.getAttribute('data-simulation-time'))).toBeLessThan(peak)
    await page.getByRole('button', { name: 'Exploration tools', exact: true }).click()
    await tools.getByRole('tab', { name: 'Events', exact: true }).click()
    await tools.getByRole('button', { name: 'End', exact: true }).click()
    await expect.poll(async () => Number(await canvas.getAttribute('data-simulation-time'))).toBeGreaterThan(peak)
  }
  expect(errors).toEqual([])
})

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
]) {
  test(`science tools show proportional bodies and a calculated sky at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204 }),
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    const tools = page.getByRole('region', { name: 'Exploration tools' })
    await tools.getByRole('tab', { name: 'Scale', exact: true }).click()
    await tools.getByRole('button', { name: 'Show comparison' }).click()
    await expect(canvas).toHaveAttribute('data-view', 'compare')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    const radii = JSON.parse(
      (await canvas.getAttribute('data-comparison-radii'))!,
    ) as { radius: number; radiusKm: number }[]
    expect(radii).toHaveLength(3)
    expect(radii[1].radius / radii[0].radius).toBeCloseTo(
      radii[1].radiusKm / radii[0].radiusKm,
      10,
    )
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    await page.screenshot({
      path: testInfo.outputPath(`true-scale-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    await tools.getByRole('tab', { name: 'Sky', exact: true }).click()
    await tools.getByLabel('Location preset').selectOption('Greenwich')
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2026-03-20')
    await page
      .getByRole('slider', { name: 'Time of day', exact: true })
      .evaluate((element) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(element, 0)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await tools.getByRole('button', { name: 'Observe sky' }).click()
    await expect(canvas).toHaveAttribute('data-view', 'sky')
    await expect(canvas).toHaveAttribute('data-sky-site', '51.4779,0')
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-sky-stars')))
      .toBeGreaterThan(300)
    const sky = JSON.parse((await canvas.getAttribute('data-sky-bodies'))!) as {
      body: string
      altitude: number
    }[]
    expect(sky.find((body) => body.body === 'Sun')!.altitude).toBeLessThan(0)
    expect((await canvasPixels(page)).bright).toBeGreaterThan(20)
    await page.screenshot({
      path: testInfo.outputPath(`observer-sky-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    await tools.getByRole('tab', { name: 'Events', exact: true }).click()
    await tools.getByLabel('Location preset').selectOption('Dallas')
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2024-04-01')
    await tools.getByRole('button', { name: 'Find next events' }).click()
    await tools
      .getByRole('button', { name: /total solar eclipse.*2024-04-08/ })
      .click()
    await expect(
      page.getByRole('textbox', { name: 'Simulation date' }),
    ).toHaveValue('2024-04-08')
    await expect(canvas).toHaveAttribute('data-view', 'sky')
    const angular = JSON.parse(
      (await canvas.getAttribute('data-sky-angular-radii'))!,
    ) as { body: string; radians: number }[]
    expect(
      angular.find((body) => body.body === 'Moon')!.radians,
    ).toBeGreaterThan(angular.find((body) => body.body === 'Sun')!.radians)
    expect(
      Number(await canvas.getAttribute('data-solar-obscuration')),
    ).toBeGreaterThan(0.99)
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    await page.screenshot({
      path: testInfo.outputPath(`solar-eclipse-${viewport.width}.png`),
    })
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-view', 'map')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Distance ruler', exact: true })
      .click()
    await expect(canvas).toHaveAttribute('data-camera-fov', '43')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`adaptive rendering restores full detail after navigation at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204 }),
    )
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page.getByRole('switch', { name: 'Labels', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    const generation = await canvas.getAttribute('data-map-generation')
    const full = await canvas.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
    }))
    await page.mouse.move(viewport.width * 0.48, viewport.height * 0.49)
    await page.mouse.down()
    await page.mouse.move(
      viewport.width * 0.48 + 55,
      viewport.height * 0.49 - 20,
      { steps: 4 },
    )
    await expect(canvas).toHaveAttribute('data-render-quality', 'navigation')
    const moving = await canvas.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
    }))
    expect(moving.width * moving.height).toBeLessThan(
      full.width * full.height * 0.55,
    )
    const exported = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Capture image', exact: true })
      .evaluate((element) => (element as HTMLButtonElement).click())
    const stream = await (await exported).createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    const image = Buffer.concat(chunks)
    expect(image.readUInt32BE(16)).toBe(full.width)
    expect(image.readUInt32BE(20)).toBe(full.height)
    await page.mouse.up()
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    expect(
      await canvas.evaluate((element) => ({
        width: (element as HTMLCanvasElement).width,
        height: (element as HTMLCanvasElement).height,
      })),
    ).toEqual(full)
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    await expect(canvas).toHaveAttribute('data-following-id', 'earth')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    await page.screenshot({
      path: testInfo.outputPath(`adaptive-restored-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Display settings', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: 'Adaptive rendering', exact: true })
      .uncheck()
    await page
      .getByRole('button', { name: 'Close display settings', exact: true })
      .click()
    await page.mouse.move(viewport.width * 0.48, viewport.height * 0.49)
    await page.mouse.down()
    await page.mouse.move(viewport.width * 0.48 + 30, viewport.height * 0.49, {
      steps: 3,
    })
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    await page.mouse.up()
    await page
      .getByRole('button', { name: 'Display settings', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: 'Adaptive rendering', exact: true })
      .check()
    await page
      .getByRole('button', { name: 'Close display settings', exact: true })
      .click()
    await page.mouse.move(viewport.width * 0.48, viewport.height * 0.49)
    await page.mouse.down()
    await page.mouse.move(viewport.width * 0.48 + 25, viewport.height * 0.49, {
      steps: 3,
    })
    await expect(canvas).toHaveAttribute('data-render-quality', 'navigation')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    await expect(canvas).toHaveAttribute('data-following-id', 'earth')
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
]) {
  test(`distance ruler measures moving bodies without navigating at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000)
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204 }),
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const target = await canvas.getAttribute('data-world-target')
    await page
      .getByRole('button', { name: 'Distance ruler', exact: true })
      .click()
    const panel = page.getByRole('region', {
      name: 'Distance ruler',
      exact: true,
    })
    const from = panel.getByRole('combobox', { name: 'From', exact: true })
    const to = panel.getByRole('combobox', { name: 'To', exact: true })
    await expect(panel.getByLabel('Measured distance')).toContainText('AU')
    await to.fill('Moon')
    await panel.getByRole('option', { name: /^The Moon/ }).click()
    await expect(panel.getByLabel('Measured distance')).toContainText('km')
    const result = panel.locator('.ruler-result')
    const lightTime = Number(await result.getAttribute('data-light-seconds'))
    expect(lightTime).toBeGreaterThan(1)
    expect(lightTime).toBeLessThan(1.5)
    await expect(canvas).toHaveAttribute('data-world-target', target!)
    await expect(canvas).toHaveAttribute('data-ruler-visible', 'true')
    const distance = await result.getAttribute('data-distance-pc')
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2026-10-01')
    await expect(result).not.toHaveAttribute('data-distance-pc', distance!)
    await panel.getByRole('button', { name: 'Swap endpoints' }).click()
    await expect(from).toHaveValue('The Moon')
    await expect(to).toHaveValue('Earth')
    await panel.getByRole('button', { name: 'Frame measurement' }).click()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    await expect(canvas).toHaveAttribute('data-ruler-visible', 'true')
    const bounds = (await panel.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    const endpoints = JSON.parse(
      (await canvas.getAttribute('data-ruler-screen-points'))!,
    ) as number[][]
    for (const [horizontal, vertical] of endpoints) {
      expect(horizontal).toBeGreaterThan(0)
      expect(horizontal).toBeLessThan(viewport.width)
      expect(vertical).toBeGreaterThan(170)
      expect(vertical).toBeLessThan(viewport.height - 144)
      expect(
        horizontal < bounds.x ||
          horizontal > bounds.x + bounds.width ||
          vertical < bounds.y ||
          vertical > bounds.y + bounds.height,
      ).toBe(true)
    }
    await page.screenshot({
      path: testInfo.outputPath(`earth-moon-ruler-${viewport.width}.png`),
    })
    await from.fill('Voyager 1')
    await panel.getByRole('option', { name: /^Voyager 1/ }).click()
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2035-01-01')
    await expect(panel.getByLabel('Measured distance')).toHaveText(
      'Unavailable',
    )
    await expect(canvas).toHaveAttribute('data-ruler-visible', 'false')
    await panel.getByRole('button', { name: 'Clear measurement' }).click()
    await expect(from).toHaveValue('')
    await expect(to).toHaveValue('')
    await panel.getByRole('button', { name: 'Close distance ruler' }).click()
    await expect(panel).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`galactic dust adds reversible depth-dependent attenuation at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.route('**/favicon.ico', (route) =>
      route.fulfill({ status: 204 }),
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=milky-way&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page.getByRole('switch', { name: 'Labels', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-galaxy-dust', 'enabled')
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    const horizontal = viewport.width > 760 ? 680 : 175
    const vertical = viewport.width > 760 ? 555 : 470
    await page.mouse.move(horizontal, vertical)
    await page.mouse.down()
    await page.mouse.move(horizontal, vertical - viewport.height * 0.25, {
      steps: 4,
    })
    await page.mouse.up()
    await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    const generation = await canvas.getAttribute('data-map-generation')
    const camera = await canvas.getAttribute('data-camera-distance')
    await page
      .getByRole('button', { name: 'Display settings', exact: true })
      .click()
    const dust = page.getByRole('checkbox', {
      name: 'Galactic dust',
      exact: true,
    })
    await dust.uncheck()
    await expect(canvas).toHaveAttribute('data-galaxy-dust', 'disabled')
    let previousChecksum = -1
    let stableFrames = 0
    await expect
      .poll(
        async () => {
          const pixels = await canvasPixels(page)
          stableFrames =
            pixels.checksum === previousChecksum ? stableFrames + 1 : 0
          previousChecksum = pixels.checksum
          return stableFrames
        },
        { intervals: [100, 250, 500] },
      )
      .toBeGreaterThanOrEqual(3)
    const clear = await canvasPixels(page)
    await page.screenshot({
      path: testInfo.outputPath(`galaxy-no-dust-${viewport.width}.png`),
    })
    await dust.check()
    await expect(canvas).toHaveAttribute('data-galaxy-dust', 'enabled')
    const dusty = await canvasPixels(page)
    expect(dusty.checksum).not.toBe(clear.checksum)
    expect(dusty.bright).toBeGreaterThan(clear.bright * 0.45)
    expect(dusty.bright).toBeLessThan(clear.bright)
    expect(dusty.clipped / Math.max(1, dusty.bright)).toBeLessThan(0.2)
    await page.screenshot({
      path: testInfo.outputPath(`galaxy-dust-${viewport.width}.png`),
    })
    await dust.uncheck()
    await expect(canvas).toHaveAttribute('data-galaxy-dust', 'disabled')
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .toBe(clear.checksum)
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    await expect(canvas).toHaveAttribute('data-camera-distance', camera!)
    const styles = page.getByRole('group', { name: 'Milky Way style' })
    await dust.check()
    await styles.getByRole('button', { name: 'Original', exact: true }).click()
    await expect(dust).toBeDisabled()
    await expect(canvas).toHaveAttribute('data-galaxy-dust', 'disabled')
    await expect(canvas).toHaveAttribute('data-galaxy-surface-layers', '0')
    expect(errors).toEqual([])
  })
}

test('deployment assets load under the configured base path', async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000)
  const base = new URL(baseURL!)
  const assetPaths = new Set<string>()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (
      url.origin === base.origin &&
      /\/(assets|textures|data)\//.test(url.pathname)
    ) {
      assetPaths.add(url.pathname)
      if (response.status() >= 400)
        errors.push(`${response.status()} ${url.pathname}`)
      if (!url.pathname.startsWith(base.pathname))
        errors.push(`Asset outside deployment path: ${url.pathname}`)
    }
  })
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    await expect(page).toHaveTitle('Hello World | Universe Explorer')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-following-id', 'earth')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-loaded-assets')))
      .toBeGreaterThan(2)
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    expect([...assetPaths]).toEqual(
      expect.arrayContaining([
        `${base.pathname}data/stars.json`,
        `${base.pathname}textures/earth.jpg`,
        `${base.pathname}textures/earth-night.jpg`,
      ]),
    )
    await page.screenshot({
      path: testInfo.outputPath(`deployment-earth-${viewport.width}.png`),
    })
    await page.goto('./?object=milky-way&view=object')
    await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
    await expect(canvas).toHaveAttribute('data-galaxy-surface-layers', '0')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    expect(assetPaths.has(`${base.pathname}textures/milky-way-nasa.jpg`)).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath(`deployment-milky-way-${viewport.width}.png`),
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  }
})

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  for (const id of [
    'pso-j318',
    'gaia-bh1',
    'pillars-of-creation',
    'butterfly-nebula',
    'sn1006',
  ]) {
    test(`new deep-sky visuals: ${id} at ${viewport.width}px retain detail and 3D interaction`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(id === 'gaia-bh1' ? 300_000 : 180_000)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.setViewportSize(viewport)
      await page.goto(`./?object=${id}&view=object`)
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-scene', id)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      if (id === 'pillars-of-creation') {
        await expect(canvas).toHaveAttribute('data-model-state', 'ready')
        expect(
          Number(await canvas.getAttribute('data-model-particles')),
        ).toBeGreaterThanOrEqual(24000)
      }
      if (id === 'gaia-bh1')
        await expect(canvas).toHaveAttribute('data-black-hole-state', 'dormant')
      await page
        .getByRole('button', { name: 'Pause simulation', exact: true })
        .click()
      await page.getByRole('switch', { name: 'Labels', exact: true }).click()
      const pixels = await canvasPixels(page)
      expect(pixels.bright, `${id} ${viewport.width}`).toBeGreaterThan(
        id === 'gaia-bh1' ? 5 : viewport.width > 760 ? 200 : 30,
      )
      expect(
        pixels.clipped / Math.max(1, pixels.bright),
        `${id} overexposure`,
      ).toBeLessThan(0.15)
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}.png`),
      })
      const horizontal = viewport.width > 760 ? 700 : 175
      const vertical = viewport.width > 760 ? 500 : 430
      await page.mouse.move(horizontal, vertical)
      await page.mouse.down()
      await page.mouse.move(horizontal + 70, vertical - 35, { steps: 4 })
      await page.mouse.up()
      await expect(canvas).toHaveAttribute('data-render-quality', 'full', {
        timeout: 45_000,
      })
      await expect
        .poll(async () => (await canvasPixels(page)).checksum, {
          timeout: id === 'gaia-bh1' ? 45_000 : 15_000,
        })
        .not.toBe(pixels.checksum)
      const distance = Number(await canvas.getAttribute('data-camera-distance'))
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect
        .poll(async () =>
          Number(await canvas.getAttribute('data-camera-distance')),
        )
        .toBeLessThan(distance * 0.9)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}-oblique.png`),
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      expect(errors).toEqual([])
    })
  }
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`void emits no light or shell and remains traversable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('./?object=bootes-void&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-void-representation',
      'non-emitting-reference-region',
    )
    await expect(canvas).toHaveAttribute('data-void-interior-markers', '0')
    await expect(canvas).toHaveAttribute('data-void-surface-layers', '0')
    expect((await canvasPixels(page)).bright).toBe(0)
    await page.screenshot({
      path: testInfo.outputPath(`non-emitting-void-${viewport.width}.png`),
    })
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-following-id', 'bootes-void')
    for (let index = 0; index < 9; index++)
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    expect(
      Number(await canvas.getAttribute('data-world-distance-pc')),
    ).toBeLessThan(50000000)
    await expect(canvas).toHaveAttribute('data-following-id', 'bootes-void')
    await page.screenshot({
      path: testInfo.outputPath(`inside-void-${viewport.width}.png`),
    })
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`white dwarfs render compact surfaces and map positions at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    await page.setViewportSize(viewport)
    for (const id of ['sirius-b', '40-eridani-b', 'van-maanen']) {
      await page.goto(`./?object=${id}&view=object`)
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await expect(canvas).toHaveAttribute(
        'data-white-dwarf-appearance',
        'compact-cooling-photosphere',
      )
      expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}.png`),
      })
      await page.getByRole('tab', { name: '3D map', exact: true }).click()
      await expect(canvas).toHaveAttribute('data-following-id', id)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await expect(canvas).toHaveAttribute(
        'data-active-model-ids',
        new RegExp(`(^|,)${id}(,|$)`),
      )
      expect((await canvasPixels(page)).bright).toBeGreaterThan(25)
    }
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`spectrum modes change emission without moving the camera at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const baseline = await canvasPixels(page)
    const generation = await canvas.getAttribute('data-map-generation')
    const camera = await canvas.getAttribute('data-camera-distance')
    const select = page.getByRole('combobox', {
      name: 'Observation spectrum',
    })
    for (const band of [
      'infrared',
      'ultraviolet',
      'radio',
      'xray',
      'gamma',
    ]) {
      await select.selectOption(band)
      await expect(canvas).toHaveAttribute('data-observation-band', band)
      await expect(canvas).toHaveAttribute('data-map-generation', generation!)
      await expect(canvas).toHaveAttribute('data-camera-distance', camera!)
      const pixels = await canvasPixels(page)
      expect(pixels.checksum).not.toBe(baseline.checksum)
      if (band === 'infrared') expect(pixels.bright).toBeGreaterThan(100)
      if (band === 'gamma' || band === 'xray') expect(pixels.bright).toBe(0)
    }
    await select.selectOption('visible')
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .toBe(baseline.checksum)
    await page.goto('./?object=crab&view=object')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await select.selectOption('xray')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(25)
    await page.screenshot({
      path: testInfo.outputPath(`crab-xray-${viewport.width}.png`),
    })
    await page.goto('./?object=virgo&view=object')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await select.selectOption('xray')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(25)
    await page.screenshot({
      path: testInfo.outputPath(`virgo-xray-${viewport.width}.png`),
    })
    await page.goto('./?object=pillars-of-creation&view=object')
    await select.selectOption('gamma')
    await expect(canvas).toHaveAttribute('data-model-state', 'ready')
    expect((await canvasPixels(page)).bright).toBe(0)
    await page.goto('./?object=bootes-void&view=object')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    for (const band of ['visible', 'infrared', 'xray', 'gamma']) {
      await select.selectOption(band)
      expect((await canvasPixels(page)).bright).toBe(0)
    }
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`atlas planetary views use their own hosts and physical pair scale at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    await page
      .getByRole('button', { name: 'Exploration tools', exact: true })
      .click()
    await page.getByRole('tab', { name: 'Atlas', exact: true }).click()
    const atlas = page.getByRole('navigation', { name: 'Atlas destinations' })
    await expect(atlas.getByRole('button')).toHaveCount(15)
    await atlas
      .getByRole('button', { name: 'Proxima Centauri System', exact: true })
      .click()
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute(
      'data-system-representation',
      'proxima-host-relative-kepler-illustration',
    )
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).not.toHaveAttribute(
      'data-system-members',
      /proxima-c/,
    )
    await page
      .getByRole('checkbox', { name: 'Include candidate Proxima c' })
      .check()
    await expect(canvas).toHaveAttribute('data-system-members', /proxima-c/)
    const controlBounds = (await page
      .locator('.model-control')
      .boundingBox())!
    const tools = page.getByRole('region', { name: 'Exploration tools' })
    await expect(tools).toBeVisible()
    if (viewport.width < 760) {
      const panelBounds = (await tools.boundingBox())!
      expect(controlBounds.y + controlBounds.height).toBeLessThan(panelBounds.y)
      await tools.getByRole('button', { name: 'Close exploration tools', exact: true }).click()
    }
    const headingBounds = (await page
      .locator('.scene-heading')
      .boundingBox())!
    expect(controlBounds.y + controlBounds.height).toBeLessThanOrEqual(
      headingBounds.y,
    )
    expect((await canvasPixels(page)).bright).toBeGreaterThan(
      viewport.width > 760 ? 50 : 25,
    )
    await page.screenshot({
      path: testInfo.outputPath(`proxima-system-${viewport.width}.png`),
    })
    await page.goto('./?object=exo%3AProxima%20Cen%20b&view=orbit')
    await expect(canvas).toHaveAttribute(
      'data-system-representation',
      'proxima-host-relative-kepler-illustration',
    )
    await expect(canvas).toHaveAttribute(
      'data-system-members',
      'proxima,exo:Proxima Cen b',
    )
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute(
      'data-following-id',
      'exo:Proxima Cen b',
    )
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-host-orbit-ids',
      /exo:Proxima Cen b/,
    )
    await page.goto('./?object=earth-moon&view=object')
    await expect(canvas).toHaveAttribute(
      'data-system-representation',
      'earth-moon-physical-scale',
    )
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    const radii = JSON.parse(
      (await canvas.getAttribute('data-earth-moon-radii'))!,
    )
    expect(radii[0] / radii[1]).toBeCloseTo(6371 / 1737.4, 5)
    const distance = Number(
      await canvas.getAttribute('data-earth-moon-distance-km'),
    )
    expect(distance).toBeGreaterThan(350000)
    expect(distance).toBeLessThan(410000)
    await page.screenshot({
      path: testInfo.outputPath(`earth-moon-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Step forward one day', exact: true })
      .click()
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-earth-moon-distance-km')),
      )
      .not.toBe(distance)
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`cosmology diagrams separate density and expansion from emitted light at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    await page.setViewportSize(viewport)
    const canvas = page.locator('.universe-canvas canvas')
    await page.goto('./?object=dark-matter&view=object')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-cosmology-representation',
      'synthetic-dark-matter-density',
    )
    await expect(
      page.getByRole('combobox', { name: 'Observation spectrum' }),
    ).toBeDisabled()
    const original = await canvasPixels(page)
    expect(original.bright).toBeGreaterThan(25)
    await page.getByRole('slider', { name: 'Density contrast' }).fill('0.25')
    await expect(canvas).toHaveAttribute('data-density-gain', '0.250')
    expect((await canvasPixels(page)).checksum).not.toBe(original.checksum)
    await page.screenshot({
      path: testInfo.outputPath(`dark-matter-${viewport.width}.png`),
    })
    await page.goto('./?object=dark-energy&view=object')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-cosmology-representation',
      'flat-lcdm-distance-expansion',
    )
    await page
      .getByRole('slider', { name: 'Cosmic age in billion years' })
      .fill('13.8')
    await expect(canvas).toHaveAttribute('data-expansion-scale', '1.000000')
    const baseline = await canvasPixels(page)
    expect(baseline.bright).toBeGreaterThan(25)
    await page
      .getByRole('slider', { name: 'Cosmic age in billion years' })
      .fill('20')
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-expansion-scale')),
      )
      .toBeGreaterThan(1)
    expect((await canvasPixels(page)).checksum).not.toBe(baseline.checksum)
    await page.screenshot({
      path: testInfo.outputPath(`dark-energy-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Play simulation', exact: true })
      .click()
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-cosmic-age-gyr')),
      )
      .toBeGreaterThan(20.1)
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Play simulation', exact: true }),
    ).toBeVisible()
    const pausingFrame = await canvas.getAttribute('data-frame')
    await expect(canvas).not.toHaveAttribute('data-frame', pausingFrame!)
    const age = await canvas.getAttribute('data-cosmic-age-gyr')
    const pausedFrame = await canvas.getAttribute('data-frame')
    await canvasPixels(page)
    await expect(canvas).not.toHaveAttribute('data-frame', pausedFrame!)
    await expect(canvas).toHaveAttribute('data-cosmic-age-gyr', age!)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`Mars regions and both moons are selectable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    await page.setViewportSize(viewport)
    await page.goto('./?object=mars&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    for (const region of ['olympus', 'jezero']) {
      await page
        .getByRole('combobox', { name: 'Mars surface region' })
        .selectOption(region)
      await expect(canvas).toHaveAttribute('data-mars-region', region)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      expect((await canvasPixels(page)).bright).toBeGreaterThan(50)
      await page.screenshot({
        path: testInfo.outputPath(`mars-${region}-${viewport.width}.png`),
      })
    }
    for (const id of ['phobos', 'deimos']) {
      await page.goto(`./?object=${id}&view=object`)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await expect(canvas).toHaveAttribute(
        'data-moon-morphology',
        'irregular-regolith-illustration',
      )
      expect((await canvasPixels(page)).bright).toBeGreaterThan(50)
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}.png`),
      })
      await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      expect((await canvasPixels(page)).bright).toBeGreaterThan(25)
    }
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`Atlas opens every mapped reference experience at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(page.locator('.catalog-footer')).toContainText(
      '135,171 catalog entries',
    )
    for (const item of atlasExperiences) {
      await page
        .getByRole('button', { name: 'Exploration tools', exact: true })
        .click()
      await page.getByRole('tab', { name: 'Atlas', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Atlas destinations' })
        .getByRole('button', { name: item.name, exact: true })
        .click()
      await expect(canvas).toHaveAttribute('data-scene', item.id)
      await expect(canvas).toHaveAttribute('data-view', item.view)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      if (item.id !== 'bootes-void')
        expect((await canvasPixels(page)).bright, item.name).toBeGreaterThan(
          10,
        )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        item.name,
      ).toBe(true)
    }
    await page.screenshot({
      path: testInfo.outputPath(`atlas-mars-${viewport.width}.png`),
    })
    expect(errors).toEqual([])
  })
}

test('expanded families share one navigable world and the void has no collision wall', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  await page.goto('./?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const generation = await canvas.getAttribute('data-map-generation')
  for (const [name, id] of [
    ['Voyager 1', 'voyager-1'],
    ['WISE 0855-0714', 'wise-0855'],
    ['Gaia BH3', 'gaia-bh3'],
    ['V404 Cygni', 'v404-cygni'],
    ['Centaurus A Black Hole', 'centaurus-a-black-hole'],
    ['Perseus A Black Hole', 'perseus-a-black-hole'],
    ['Pillars of Creation', 'pillars-of-creation'],
    ['Vela Supernova Remnant', 'vela-remnant'],
    ['Pillars of Creation', 'pillars-of-creation'],
    ['Voyager 1', 'voyager-1'],
    ['Bootes Void', 'bootes-void'],
  ]) {
    const search = page.getByRole('textbox', {
      name: 'Search celestial objects',
    })
    await search.fill(name)
    await page.getByRole('button', { name, exact: true }).click()
    await expect(canvas).toHaveAttribute('data-following-id', id)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-active-model-ids',
      new RegExp(`(^|,)${id}(,|$)`),
    )
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    expect(
      (await canvas.getAttribute('data-world-target'))!
        .split(',')
        .map(Number)
        .every(Number.isFinite),
    ).toBe(true)
    if (id === 'pillars-of-creation' || id === 'voyager-1') {
      await expect(canvas).toHaveAttribute('data-model-object', id)
      await expect(canvas).toHaveAttribute('data-model-state', 'ready')
    }
    if (id !== 'bootes-void')
      expect((await canvasPixels(page)).bright, name).toBeGreaterThan(50)
  }
  await page.getByRole('textbox', { name: 'Search celestial objects' }).fill('')
  for (let index = 0; index < 9; index++)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  expect(
    Number(await canvas.getAttribute('data-world-distance-pc')),
  ).toBeLessThan(50000000)
  expect(
    Number(await canvas.getAttribute('data-world-distance-pc')),
  ).toBeGreaterThan(0)
  await expect(canvas).toHaveAttribute('data-following-id', 'bootes-void')
  await page.screenshot({ path: testInfo.outputPath('inside-bootes-void.png') })
})

test('NASA assets recover from failures and late loads cannot replace a newer scene', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let spacecraftRequests = 0
  await page.route('**/models/voyager.glb', async (route) => {
    spacecraftRequests++
    if (spacecraftRequests === 1)
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' })
    else await route.continue()
  })
  await page.goto('./?object=voyager-1&view=object')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-model-state', 'failed')
  await page.getByRole('tab', { name: '3D map', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-model-state', 'ready')
  await expect(canvas).toHaveAttribute('data-following-id', 'voyager-1')
  expect(spacecraftRequests).toBe(2)
  let nebulaRequests = 0
  await page.route('**/models/pillars-particles.json', async (route) => {
    nebulaRequests++
    if (nebulaRequests === 1)
      await route.fulfill({ json: { positions: [1e300], illumination: [] } })
    else await route.continue()
  })
  await page.goto('./?object=pillars-of-creation&view=object')
  await expect(canvas).toHaveAttribute('data-model-state', 'failed')
  await page.getByRole('tab', { name: '3D map', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-model-state', 'ready')
  expect(nebulaRequests).toBe(2)
  await page.unroute('**/models/pillars-particles.json')
  let resumeModel: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    resumeModel = resolve
  })
  await page.route('**/models/pillars-particles.json', async (route) => {
    await gate
    await route.continue()
  })
  try {
    await page.goto('./?object=pillars-of-creation&view=object')
    await expect(canvas).toHaveAttribute('data-model-state', 'loading')
    await page
      .getByRole('textbox', { name: 'Search celestial objects' })
      .fill('Earth')
    await page.getByRole('button', { name: 'Earth', exact: true }).click()
    await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-scene', 'earth')
    const completed = page.waitForResponse('**/models/pillars-particles.json')
    resumeModel()
    await (await completed).finished()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-scene', 'earth')
    await expect(page.locator('.universe-canvas canvas')).toHaveCount(1)
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    expect(errors).toEqual([])
  } finally {
    resumeModel()
  }
})

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`Tools keeps the selected tab when changing Atlas destinations at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(360_000)
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    const toolsButton = page.getByRole('button', {
      name: 'Exploration tools',
      exact: true,
    })
    await toolsButton.click()
    const tools = page.getByRole('region', { name: 'Exploration tools' })
    await tools.getByRole('tab', { name: 'Atlas', exact: true }).click()
    for (const [name, id] of [
      ['Mars', 'mars'],
      ['Laniakea', 'laniakea'],
      ['Milky Way', 'milky-way'],
    ]) {
      await tools
        .getByRole('navigation', { name: 'Atlas destinations' })
        .getByRole('button', { name, exact: true })
        .click()
      await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
        'data-scene',
        id,
      )
      await expect(tools).toBeVisible()
      await expect(
        tools.getByRole('tab', { name: 'Atlas', exact: true }),
      ).toHaveAttribute('aria-selected', 'true')
      await expect(toolsButton).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page.getByRole('button', { name: 'Explore', exact: true }),
      ).not.toHaveClass(/selected/)
    }
    await tools.getByRole('tab', { name: 'Scale', exact: true }).click()
    await expect(
      tools.getByRole('tab', { name: 'Scale', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    const panelBounds = (await tools.boundingBox())!
    const cameraBounds = (await page
      .getByRole('toolbar', { name: 'Camera controls' })
      .boundingBox())!
    expect(
      cameraBounds.x + cameraBounds.width <= panelBounds.x ||
        panelBounds.x + panelBounds.width <= cameraBounds.x,
    ).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`persistent-tools-${viewport.width}.png`),
    })
    await tools
      .getByRole('button', { name: 'Close exploration tools', exact: true })
      .click()
    await expect(tools).toHaveCount(0)
    await expect(page.locator('.universe-canvas canvas')).toHaveAttribute(
      'data-scene',
      'milky-way',
    )
    await toolsButton.click()
    await expect(
      tools.getByRole('tab', { name: 'Scale', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await toolsButton.click()
    await expect(tools).toBeVisible()
    await page.getByRole('button', { name: 'Explore', exact: true }).click()
    await expect(tools).toHaveCount(0)
  })
}

test('unselected Laniakea appears between local groups and the observable horizon', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('./?object=solar-system')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  const generation = await canvas.getAttribute('data-map-generation')
  const scale = page.getByRole('slider', { name: 'Map scale', exact: true })
  const setScale = async (value: number) =>
    scale.evaluate((element, next) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(element, next)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  for (const [logDistance, laniakea, universe] of [
    [6, false, false],
    [7.5, true, false],
    [8.3, true, false],
    [9.5, true, true],
  ] as const) {
    await setScale(logDistance)
    await expect
      .poll(async () =>
        Math.log10(
          Number(await canvas.getAttribute('data-world-distance-pc')),
        ),
      )
      .toBeCloseTo(logDistance, 3)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    for (const [id, visible] of [
      ['laniakea', laniakea],
      ['universe', universe],
    ] as const) {
      if (visible)
        await expect(canvas).toHaveAttribute(
          'data-active-model-ids',
          new RegExp(`(^|,)${id}(,|$)`),
        )
      else
        await expect(canvas).not.toHaveAttribute(
          'data-active-model-ids',
          new RegExp(`(^|,)${id}(,|$)`),
        )
    }
    expect(
      Number(await canvas.getAttribute('data-world-distance-pc')),
    ).toBeCloseTo(10 ** logDistance, -3)
    await expect(canvas).toHaveAttribute('data-scene', 'solar-system')
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    if (logDistance === 7.5)
      await expect(page.locator('.continuous-scale > span')).toHaveText(
        'Supercluster Neighborhood',
      )
    await page.screenshot({
      path: testInfo.outputPath(`continuous-scale-${logDistance}.png`),
    })
  }
  await setScale(7.5)
  await expect
    .poll(async () =>
      Math.log10(Number(await canvas.getAttribute('data-world-distance-pc'))),
    )
    .toBeCloseTo(7.5, 3)
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  const before = Number(await canvas.getAttribute('data-world-distance-pc'))
  await canvas.dispatchEvent('wheel', {
    deltaY: 100000,
    clientX: 720,
    clientY: 500,
    bubbles: true,
  })
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeGreaterThan(before * 1.05)
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  expect(
    Number(await canvas.getAttribute('data-world-distance-pc')),
  ).toBeGreaterThan(before)
  expect(
    Number(await canvas.getAttribute('data-world-distance-pc')),
  ).toBeLessThan(before * 1.4)
  await expect(canvas).not.toHaveAttribute(
    'data-active-model-ids',
    /(^|,)universe(,|$)/,
  )
})

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`Laniakea filaments keep dark gaps and warm knots at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=laniakea&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-laniakea-representation',
      'catalog-anchored-filament-web',
    )
    await expect(canvas).toHaveAttribute(
      'data-laniakea-radius-pc',
      '80000000',
    )
    expect(
      Number(await canvas.getAttribute('data-laniakea-filaments')),
    ).toBeGreaterThan(200)
    expect(
      Number(await canvas.getAttribute('data-laniakea-threads')),
    ).toBeGreaterThan(10000)
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
    const pixels = await canvasPixels(page)
    expect(pixels.bright).toBeGreaterThan(viewport.width > 760 ? 1000 : 150)
    expect(pixels.warmStars).toBeGreaterThan(viewport.width > 760 ? 100 : 20)
    expect(pixels.coolStars).toBeGreaterThan(viewport.width > 760 ? 100 : 20)
    expect(pixels.clipped / Math.max(1, pixels.bright)).toBeLessThan(0.08)
    await page.screenshot({
      path: testInfo.outputPath(`laniakea-filaments-${viewport.width}.png`),
    })
    await page.mouse.move(viewport.width * 0.45, viewport.height * 0.45)
    await page.mouse.down()
    await page.mouse.move(viewport.width * 0.63, viewport.height * 0.54, {
      steps: 6,
    })
    await page.mouse.up()
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .not.toBe(pixels.checksum)
    await page.screenshot({
      path: testInfo.outputPath(
        `laniakea-filaments-${viewport.width}-rotated.png`,
      ),
    })
    expect(errors).toEqual([])
  })
}

test('NASA Voyager models and open trajectories share the metric map', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    const minimumPixels = viewport.width > 760 ? 100 : 15
    await page.setViewportSize(viewport)
    await page.goto('./?object=voyager-1')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-following-id', 'voyager-1')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-model-state', 'ready')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    const target = (await canvas.getAttribute('data-world-target'))!
      .split(',')
      .map(Number)
    expect(Math.hypot(...target) * 206264.80624709636).toBeGreaterThan(170)
    expect(Math.hypot(...target) * 206264.80624709636).toBeLessThan(174)
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page.screenshot({
      path: testInfo.outputPath(`voyager-map-${viewport.width}.png`),
    })
    await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-model-state', 'ready')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(minimumPixels)
    await page.screenshot({
      path: testInfo.outputPath(`voyager-model-${viewport.width}.png`),
    })
    await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-view', 'orbit')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-model-state', 'ready')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(minimumPixels)
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2035-01-01')
    await expect(
      page.getByRole('tab', { name: 'Orbit', exact: true }),
    ).toBeDisabled()
    expect(errors).toEqual([])
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2026-09-16')
    await expect(
      page.getByRole('tab', { name: 'Orbit', exact: true }),
    ).toBeEnabled()
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-following-id', 'voyager-1')
    await page
      .getByRole('textbox', { name: 'Simulation date' })
      .fill('2035-01-01')
    await expect(canvas).toHaveAttribute('data-following-id', '')
    expect(
      (await canvas.getAttribute('data-world-target'))!
        .split(',')
        .map(Number)
        .every(Number.isFinite),
    ).toBe(true)
    await page.goto('./?object=voyager-2')
    await expect(canvas).toHaveAttribute('data-following-id', 'voyager-2')
    await expect(canvas).toHaveAttribute('data-model-state', 'ready')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    expect(errors).toEqual([])
  }
})

test('mobile Follow survives pinch zoom and fits narrow viewports', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(canvas).toHaveAttribute('data-following-id', 'earth')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const before = (await canvas.getAttribute('data-world-target'))!
    .split(',')
    .map(Number)
  const distance = Number(await canvas.getAttribute('data-world-distance-pc'))
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 155, y: 380, id: 1 },
      { x: 205, y: 420, id: 2 },
    ],
  })
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 155 - step * 6, y: 380 - step * 2, id: 1 },
        { x: 205 + step * 6, y: 420 + step * 2, id: 2 },
      ],
    })
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
  await expect(canvas).toHaveAttribute('data-following-id', 'earth')
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeLessThan(distance * 0.9)
  const after = (await canvas.getAttribute('data-world-target'))!
    .split(',')
    .map(Number)
  expect(
    Math.hypot(...after.map((coordinate, index) => coordinate - before[index])),
  ).toBeLessThan(1e-13)
  await expect(page.locator('.scene-heading h1')).toHaveText('Earth')
  await page.screenshot({
    path: testInfo.outputPath('mobile-earth-follow.png'),
  })
  await page.setViewportSize({ width: 320, height: 700 })
  expect(
    await page
      .locator('.view-layers')
      .evaluate((element) =>
        [...element.children].every(
          (child) => child.getBoundingClientRect().right <= innerWidth,
        ),
      ),
  ).toBe(true)
  await page.getByRole('switch', { name: 'Follow selected body' }).click()
  await expect(canvas).toHaveAttribute('data-following-id', '')
})

test('solar flares and accretion flows animate and pause on desktop and mobile', async ({
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
    for (const id of ['sun', 'sagittarius-a', '3c273']) {
      await page.goto(`/?object=${id}&view=object`)
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await page
        .getByRole('combobox', { name: 'Simulation speed' })
        .selectOption({ label: 'Real time' })
      if (id === 'sun')
        await expect(canvas).toHaveAttribute(
          'data-solar-activity',
          'prominences,plasma,granulation',
        )
      const before = await canvasPixels(page)
      const time = Number(await canvas.getAttribute('data-visual-time'))
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-visual-time')))
        .toBeGreaterThan(time + 1)
      const after = await canvasPixels(page)
      expect(after.checksum, `${id} animation`).not.toBe(before.checksum)
      expect(after.bright, `${id} visible`).toBeGreaterThan(
        viewport.width > 760 ? 200 : 60,
      )
      await page
        .getByRole('button', { name: 'Pause simulation', exact: true })
        .click()
      const paused = await canvas.getAttribute('data-visual-time')
      const frame = await canvas.getAttribute('data-frame')
      await expect(canvas).not.toHaveAttribute('data-frame', frame!)
      await expect(canvas).toHaveAttribute('data-visual-time', paused!)
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}-activity.png`),
      })
      expect(errors).toEqual([])
    }
  }
})

test('new moons and deep-sky objects are mapped with their orbital context', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?object=europa')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-following-id', 'europa')
  await expect(canvas).toHaveAttribute(
    'data-active-model-ids',
    /(^|,)europa(,|$)/,
  )
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Orbit', exact: true }).click()
  await expect(page.locator('.orbit-data-table')).toContainText('Jupiter')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
  await page.getByRole('tab', { name: '3D map', exact: true }).click()
  for (const name of ['Pleiades', 'Eagle Nebula', 'Coma Cluster']) {
    await page
      .getByRole('textbox', { name: 'Search celestial objects' })
      .fill(name)
    await page
      .locator('.catalog-scroll')
      .getByRole('button', { name, exact: true })
      .click()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(page.locator('.scene-heading h1')).toHaveText(name)
    expect((await canvasPixels(page)).bright).toBeGreaterThan(70)
    await page.screenshot({
      path: testInfo.outputPath(`${name.replaceAll(' ', '-')}.png`),
    })
  }
  expect(errors).toEqual([])
})

test('follow keeps Earth centered through zoom, orbit gestures, and time changes', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?object=earth')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await expect(canvas).toHaveAttribute('data-following-id', 'earth')
  const target = (await canvas.getAttribute('data-world-target'))!
    .split(',')
    .map(Number)
  const assertTarget = async () => {
    const current = (await canvas.getAttribute('data-world-target'))!
      .split(',')
      .map(Number)
    expect(
      Math.hypot(
        ...current.map((coordinate, index) => coordinate - target[index]),
      ),
    ).toBeLessThan(1e-13)
    await expect(canvas).toHaveAttribute('data-following-id', 'earth')
    await expect(page.locator('.scene-heading h1')).toHaveText('Earth')
  }
  await page.mouse.move(700, 480)
  for (const delta of [-260, 480, -220]) {
    await page.mouse.wheel(0, delta)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await assertTarget()
  }
  await page.mouse.move(650, 480)
  await page.mouse.down()
  await page.mouse.move(700, 510, { steps: 10 })
  await page.mouse.up()
  await assertTarget()
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await assertTarget()
  await page.getByLabel('Simulation date').fill('2027-03-16')
  await expect(canvas).not.toHaveAttribute(
    'data-world-target',
    target.join(','),
  )
  await expect(canvas).toHaveAttribute('data-following-id', 'earth')
  await expect(page.locator('.object-identity h2')).toHaveText('Earth')
  await page.screenshot({ path: testInfo.outputPath('earth-followed.png') })
  await page.getByRole('switch', { name: 'Follow selected body' }).click()
  await expect(canvas).toHaveAttribute('data-following-id', '')
  await page.getByRole('switch', { name: 'Follow selected body' }).click()
  await expect(canvas).toHaveAttribute('data-following-id', 'earth')
  await page.mouse.move(650, 480)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(700, 495, { steps: 10 })
  await page.mouse.up({ button: 'right' })
  await expect(canvas).toHaveAttribute('data-following-id', '')
  expect(errors).toEqual([])
})

test('late catalog loading cannot override a newer camera navigation', async ({
  page,
}) => {
  let resumeCatalog: () => void = () => undefined
  const catalogGate = new Promise<void>((resolve) => {
    resumeCatalog = resolve
  })
  await page.route('**/data/stars.json', async (route) => {
    await catalogGate
    await route.continue()
  })
  try {
    await page.goto('/?object=exo%3ATRAPPIST-1%20e')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-map-context', 'unified')
    await page
      .getByRole('slider', { name: 'Map scale', exact: true })
      .evaluate((element) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(element, 3)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-world-distance-pc')),
      )
      .toBeCloseTo(1000, 0)
    resumeCatalog()
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-scene', 'solar-system')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-world-distance-pc')),
      )
      .toBeCloseTo(1000, 0)
  } finally {
    resumeCatalog()
  }
})

test('view links preserve orbital and map modes across reloads', async ({
  page,
}) => {
  await page.goto('/?object=earth&view=orbit')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-view', 'orbit')
  await expect(
    page.getByRole('tab', { name: 'Orbit', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
  await expect(page).toHaveURL(/view=object/)
  await page.getByRole('tab', { name: '3D map', exact: true }).click()
  await expect(page).toHaveURL(/view=map/)
  await page.reload()
  await expect(canvas).toHaveAttribute('data-view', 'map')
  await expect(canvas).toHaveAttribute('data-scene', 'earth')
  await page.goto('/?object=milky-way&view=orbit')
  await expect(canvas).toHaveAttribute('data-view', 'object')
  await expect(
    page.getByRole('tab', { name: 'Orbit', exact: true }),
  ).toBeDisabled()
})

test('dialog shortcuts cannot move the camera and Escape closes focused search', async ({
  page,
}) => {
  await page.goto('/?object=earth&view=object')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const distance = Number(await canvas.getAttribute('data-camera-distance'))
  await page
    .getByRole('button', { name: 'Data and image credits', exact: true })
    .click()
  await expect(page.locator('.sources-dialog')).toBeVisible()
  await page.keyboard.press('+')
  await page.keyboard.press('r')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  expect(Number(await canvas.getAttribute('data-camera-distance'))).toBeCloseTo(
    distance,
    5,
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('.sources-dialog')).not.toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('button', { name: 'Open object catalog', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Search celestial objects' })
    .fill('Mars')
  await page.keyboard.press('Escape')
  await expect(page.locator('.catalog-sidebar')).not.toHaveClass(/\bopen\b/)
})

test('changing the scale slider mid-flight honors the latest absolute distance', async ({
  page,
}) => {
  await page.goto('/')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  const slider = page.getByRole('slider', { name: 'Map scale', exact: true })
  for (const exponent of [6, -2]) {
    await slider.evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, exponent)
    await expect(canvas).toHaveAttribute('data-flying', 'true')
  }
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute('data-world-distance-pc')),
    )
    .toBeCloseTo(0.01, 5)
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
    (element, original) =>
      new Promise<number>((resolve) => {
        let frames = 0
        let drift = 0
        const measure = () => {
          const position = (element as HTMLCanvasElement).dataset
            .worldCamera!.split(',')
            .map(Number)
          drift = Math.max(
            drift,
            Math.hypot(
              ...position.map(
                (coordinate, index) => coordinate - original[index],
              ),
            ),
          )
          if (++frames === 12) resolve(drift)
          else requestAnimationFrame(measure)
        }
        requestAnimationFrame(measure)
      }),
    originalPosition,
  )
  expect(maximumDrift).toBeLessThanOrEqual(
    Math.hypot(...originalPosition) * Number.EPSILON * 32,
  )
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
  let releaseCatalog: () => void = () => undefined
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve
  })
  await page.route('**/data/stars.json', async (route) => {
    await catalogGate
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ rows: [['invalid', null]] }),
    })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-map-context', 'unified')
  const curatedCount = await canvas.getAttribute('data-map-objects')
  expect(Number(curatedCount)).toBeGreaterThan(0)
  releaseCatalog()
  await expect(
    page.getByRole('button', { name: 'Retry catalog loading', exact: true }),
  ).toBeVisible()
  await expect(canvas).toHaveAttribute('data-map-objects', curatedCount!)
  await expect(canvas).toHaveAttribute('data-catalog-ready', 'false')
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
  for (let index = 0; index < 55; index++) await page.mouse.wheel(0, 1000)
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
  for (let index = 0; index < 40; index++) await page.mouse.wheel(0, -1000)
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
  for (let step = 0; step < 40; step++) {
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
  for (let step = 0; step < 14; step++) await page.mouse.wheel(0, -700)
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
    if (name === 'Stellar Neighborhood')
      await expect(canvas).toHaveAttribute('data-following-id', '')
    await expect(page.locator('.scene-heading h1')).toHaveText(name)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    expect((await canvasPixels(page)).bright, name).toBeGreaterThan(100)
    await page.screenshot({
      path: testInfo.outputPath(`${name.replace(/[^a-z0-9]/gi, '-')}.png`),
    })
    expect(errors, name).toEqual([])
  }
})

test('Hello World branding and fullscreen work on desktop and phone', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?object=earth&view=object')
    await expect(page).toHaveTitle('Hello World | Universe Explorer')
    await expect(
      page.getByRole('link', { name: 'Hello World home' }),
    ).toContainText('Hello World')
    const brand = await page.locator('.brand-wrap').boundingBox()
    const navigation = await page
      .getByRole('navigation', { name: 'Main navigation' })
      .boundingBox()
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(navigation!.x)
    const enter = page.getByRole('button', {
      name: 'Enter fullscreen',
      exact: true,
    })
    await expect(enter).toBeVisible()
    await expect(enter).toHaveAttribute('aria-pressed', 'false')
    await enter.click()
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(true)
    const exit = page.getByRole('button', {
      name: 'Exit fullscreen',
      exact: true,
    })
    await expect(exit).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(async () => (await canvasPixels(page)).bright)
      .toBeGreaterThan(100)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`hello-world-fullscreen-${viewport.width}.png`),
    })
    await exit.click()
    await expect(enter).toHaveAttribute('aria-pressed', 'false')
    await enter.click()
    await expect(exit).toBeVisible()
    await page.evaluate(() => document.exitFullscreen())
    await expect(enter).toHaveAttribute('aria-pressed', 'false')
  }
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () =>
      Promise.reject(new DOMException('Fullscreen denied', 'NotAllowedError'))
  })
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect(
    page.getByText('Fullscreen is not available in this browser.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Enter fullscreen' }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(errors).toEqual([])
})

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`cosmic structures retain depth and sparse voids at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    for (const id of ['universe', 'laniakea', 'virgo']) {
      await page.goto(`./?object=${id}&view=object`)
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await page
        .getByRole('button', { name: 'Pause simulation', exact: true })
        .click()
      await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
      if (id === 'universe') {
        await expect(canvas).toHaveAttribute(
          'data-cosmic-web-representation',
          'curved-filaments-and-voids',
        )
        expect(
          Number(await canvas.getAttribute('data-cosmic-web-voids')),
        ).toBe(6)
        expect(
          Number(await canvas.getAttribute('data-cosmic-web-filaments')),
        ).toBeGreaterThan(100)
        expect(
          Number(await canvas.getAttribute('data-cosmic-web-particles')),
        ).toBeGreaterThan(10000)
      }
      if (id === 'laniakea') {
        await expect(canvas).toHaveAttribute(
          'data-laniakea-representation',
          'catalog-anchored-filament-web',
        )
        expect(
          Number(await canvas.getAttribute('data-laniakea-flow-curves')),
        ).toBeGreaterThanOrEqual(80)
        await expect(canvas).toHaveAttribute(
          'data-structure-members',
          'local-group,virgo,fornax-cluster,norma-cluster',
        )
      }
      if (id === 'virgo')
        await expect(canvas).toHaveAttribute(
          'data-cluster-representation',
          'concentrated-galaxies',
        )
      const overview = await canvasPixels(page)
      expect(overview.bright, id).toBeGreaterThan(
        viewport.width > 760 ? 100 : 25,
      )
      expect(
        overview.clipped / Math.max(1, overview.bright),
        id,
      ).toBeLessThan(0.12)
      await page.screenshot({
        path: testInfo.outputPath(`${id}-${viewport.width}-overview.png`),
      })
      await page.mouse.move(viewport.width * 0.5, viewport.height * 0.45)
      await page.mouse.down()
      await page.mouse.move(viewport.width * 0.62, viewport.height * 0.52, {
        steps: 6,
      })
      await page.mouse.up()
      await expect
        .poll(async () => (await canvasPixels(page)).checksum)
        .not.toBe(overview.checksum)
      const beforeZoom = Number(
        await canvas.getAttribute('data-camera-distance'),
      )
      await page.getByRole('button', { name: 'Show UI', exact: true }).click()
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect
        .poll(async () =>
          Number(await canvas.getAttribute('data-camera-distance')),
        )
        .toBeLessThan(beforeZoom * 0.95)
    }
    await page.goto('./?object=universe')
    const mapped = page.locator('.universe-canvas canvas')
    await expect(mapped).toHaveAttribute('data-flying', 'false')
    await expect(mapped).toHaveAttribute(
      'data-active-model-ids',
      /(^|,)universe(,|$)/,
    )
    await expect(mapped).toHaveAttribute(
      'data-cosmic-web-representation',
      'curved-filaments-and-voids',
    )
    const mappedPixels = await canvasPixels(page)
    expect(mappedPixels.bright).toBeGreaterThan(
      viewport.width > 760 ? 100 : 25,
    )
    expect(
      mappedPixels.clipped / Math.max(1, mappedPixels.bright),
    ).toBeLessThan(0.12)
    expect(
      Number(await mapped.getAttribute('data-world-distance-pc')),
    ).toBeGreaterThan(1e9)
    await page.screenshot({
      path: testInfo.outputPath(`cosmic-map-${viewport.width}.png`),
    })
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`named galaxy groups and Laniakea flows stay navigable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=ngc-6769-group&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-group-representation',
      'catalog-triplet-with-tidal-trails',
    )
    await expect(canvas).toHaveAttribute(
      'data-structure-members',
      'ngc-6769,ngc-6770,ngc-6771',
    )
    const group = await canvasPixels(page)
    expect(group.bright).toBeGreaterThan(viewport.width > 760 ? 250 : 35)
    expect(group.clipped / Math.max(1, group.bright)).toBeLessThan(0.08)
    await page.screenshot({
      path: testInfo.outputPath(`ngc-triplet-${viewport.width}.png`),
    })
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    for (const id of ['ngc-6769', 'ngc-6770', 'ngc-6771'])
      await expect(canvas).toHaveAttribute(
        'data-active-model-ids',
        new RegExp(`(^|,)${id}(,|$)`),
      )
    expect((await canvasPixels(page)).bright).toBeGreaterThan(
      viewport.width > 760 ? 200 : 25,
    )
    await page.screenshot({
      path: testInfo.outputPath(`ngc-triplet-map-${viewport.width}.png`),
    })
    await page.goto('./?object=laniakea')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-active-model-ids',
      /(^|,)laniakea(,|$)/,
    )
    await expect(canvas).toHaveAttribute(
      'data-laniakea-representation',
      'catalog-anchored-filament-web',
    )
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const paused = await canvasPixels(page)
    const time = await canvas.getAttribute('data-visual-time')
    expect((await canvasPixels(page)).checksum).toBe(paused.checksum)
    await expect(canvas).toHaveAttribute('data-visual-time', time!)
    await page
      .getByRole('button', { name: 'Play simulation', exact: true })
      .click()
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .not.toBe(paused.checksum)
    await page.screenshot({
      path: testInfo.outputPath(`laniakea-map-${viewport.width}.png`),
    })
    if (viewport.width < 760)
      await page
        .getByRole('button', {
          name: 'Show details for Laniakea',
          exact: true,
        })
        .click()
    await page
      .getByRole('navigation', { name: 'Reference groups' })
      .getByRole('button', { name: 'Norma Cluster', exact: true })
      .click()
    await expect(canvas).toHaveAttribute('data-scene', 'norma-cluster')
    await page.goto('./?object=ngc-6769-group&view=object')
    if (viewport.width < 760)
      await page
        .getByRole('button', {
          name: 'Show details for NGC 6769 Group',
          exact: true,
        })
        .click()
    await page
      .getByRole('navigation', { name: 'Group members' })
      .getByRole('button', { name: 'NGC 6770', exact: true })
      .click()
    await expect(canvas).toHaveAttribute('data-scene', 'ngc-6770')
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`TON 618 keeps its luminous disk and interactive lensing at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=ton618&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-quasar-appearance',
      'cool-core-warm-disk',
    )
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const still = await canvasPixels(page)
    expect(still.bright).toBeGreaterThan(viewport.width > 760 ? 250 : 40)
    expect(still.coolStars).toBeGreaterThan(10)
    expect(still.warmStars).toBeGreaterThan(10)
    expect(still.clipped / Math.max(1, still.bright)).toBeLessThan(0.12)
    const time = await canvas.getAttribute('data-visual-time')
    expect((await canvasPixels(page)).checksum).toBe(still.checksum)
    await expect(canvas).toHaveAttribute('data-visual-time', time!)
    await page.screenshot({
      path: testInfo.outputPath(`ton618-${viewport.width}.png`),
    })
    await page
      .getByRole('button', { name: 'Play simulation', exact: true })
      .click()
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .not.toBe(still.checksum)
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const distance = Number(await canvas.getAttribute('data-camera-distance'))
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-camera-distance')),
      )
      .toBeLessThan(distance * 0.9)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    const beforeDrag = await canvasPixels(page)
    await page.mouse.move(viewport.width * 0.48, viewport.height * 0.48)
    await page.mouse.down()
    await page.mouse.move(viewport.width * 0.57, viewport.height * 0.5, {
      steps: 6,
    })
    await page.mouse.up()
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .not.toBe(beforeDrag.checksum)
    await page.screenshot({
      path: testInfo.outputPath(`ton618-${viewport.width}-orbit.png`),
    })
    expect(errors).toEqual([])
  })
}

test('galaxy reference style switches back to the original without changing the scene', async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000)
  await page.goto('./?object=milky-way&view=object')
  const canvas = page.locator('.universe-canvas canvas')
  await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
  await expect(canvas).toHaveAttribute('data-flying', 'false')
  await expect(canvas).toHaveAttribute('data-galaxy-style', 'reference')
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page.getByRole('switch', { name: 'Labels', exact: true }).click()
  const generation = await canvas.getAttribute('data-map-generation')
  const distance = await canvas.getAttribute('data-camera-distance')
  await page
    .getByRole('button', { name: 'Display settings', exact: true })
    .click()
  const styles = page.getByRole('group', {
    name: 'Milky Way style',
    exact: true,
  })
  await styles.getByRole('button', { name: 'Original', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-galaxy-style', 'original')
  const original = await canvasPixels(page)
  await page.screenshot({ path: testInfo.outputPath('galaxy-original.png') })
  await styles.getByRole('button', { name: 'Reference', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-galaxy-style', 'reference')
  await expect
    .poll(async () => (await canvasPixels(page)).checksum, { timeout: 45_000 })
    .not.toBe(original.checksum)
  const reference = await canvasPixels(page)
  expect(reference.bright).toBeGreaterThan(1000)
  expect(reference.bright).toBeGreaterThan(original.bright * 1.15)
  expect(reference.coolStars).toBeGreaterThan(100)
  expect(reference.warmStars).toBeGreaterThan(original.warmStars)
  expect(reference.colored / Math.max(1, reference.bright)).toBeGreaterThan(
    0.3,
  )
  expect(reference.clipped / Math.max(1, reference.bright)).toBeLessThan(0.08)
  await page.screenshot({ path: testInfo.outputPath('galaxy-reference.png') })
  await styles.getByRole('button', { name: 'Original', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-galaxy-style', 'original')
  await expect
    .poll(async () => (await canvasPixels(page)).checksum, { timeout: 45_000 })
    .toBe(original.checksum)
  await expect(canvas).toHaveAttribute('data-camera-distance', distance!)
  await expect(canvas).toHaveAttribute('data-map-generation', generation!)
  await page.reload()
  await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
  await expect(canvas).toHaveAttribute('data-galaxy-style', 'original')
})

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`reference galaxy has depth and nearby stars at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=milky-way&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
    await expect(canvas).toHaveAttribute('data-galaxy-style', 'reference')
    await expect(canvas).toHaveAttribute('data-galaxy-surface-layers', '0')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute(
      'data-galaxy-overview-blend',
      '1.000',
    )
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page.getByRole('switch', { name: 'Labels', exact: true }).click()
    const overview = await canvasPixels(page)
    expect(overview.bright).toBeGreaterThan(viewport.width > 760 ? 1000 : 100)
    expect(overview.warmStars).toBeGreaterThan(
      viewport.width > 760 ? 100 : 15,
    )
    expect(overview.coolStars).toBeGreaterThan(
      viewport.width > 760 ? 100 : 15,
    )
    expect(overview.sharpDetail).toBeGreaterThan(
      viewport.width > 760 ? 250 : 30,
    )
    expect(overview.clipped / Math.max(1, overview.bright)).toBeLessThan(0.2)
    await page.screenshot({
      path: testInfo.outputPath(`reference-${viewport.width}-overview.png`),
    })
    const horizontal = viewport.width > 760 ? 680 : 175
    const vertical = viewport.width > 760 ? 555 : 470
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Number(
        await canvas.getAttribute('data-galaxy-inclination'),
      )
      if (angle > 75 && angle < 85) break
      const movement =
        Math.max(-0.06, Math.min(0.06, (80 - angle) / 198)) * viewport.height
      await page.mouse.move(horizontal, vertical)
      await page.mouse.down()
      await page.mouse.move(horizontal, vertical - movement, { steps: 4 })
      await page.mouse.up()
      await expect(canvas).toHaveAttribute('data-render-quality', 'full', {
        timeout: 30_000,
      })
    }
    const inclination = Number(
      await canvas.getAttribute('data-galaxy-inclination'),
    )
    expect(inclination).toBeGreaterThan(75)
    expect(inclination).toBeLessThan(85)
    const edge = await canvasPixels(page)
    expect(edge.bright).toBeGreaterThan(viewport.width > 760 ? 1000 : 100)
    expect(edge.sharpDetail).toBeGreaterThan(viewport.width > 760 ? 250 : 30)
    expect(edge.checksum).not.toBe(overview.checksum)
    expect(edge.clipped / Math.max(1, edge.bright)).toBeLessThan(0.35)
    await page.screenshot({
      path: testInfo.outputPath(`reference-${viewport.width}-edge.png`),
    })
    expect(errors).toEqual([])
  })
  for (const [scale, name] of [
    [4.35, 'outside'],
    [3.3, 'inside'],
  ] as const) {
    test(`reference galaxy map preserves ${name} detail and style controls at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(
        name === 'inside' ? (viewport.width > 760 ? 420_000 : 300_000) : 180_000,
      )
      await page.route('**/favicon.ico', (route) =>
        route.fulfill({ status: 204 }),
      )
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.setViewportSize(viewport)
      await page.goto('./?object=milky-way')
      const canvas = page.locator('.universe-canvas canvas')
      await expect(canvas).toHaveAttribute('data-galaxy-style', 'reference')
      await expect(canvas).toHaveAttribute('data-following-id', 'milky-way')
      await expect(canvas).toHaveAttribute(
        'data-galaxy-texture-ready',
        'true',
      )
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await page
        .getByRole('button', { name: 'Pause simulation', exact: true })
        .click()
      await page.getByRole('switch', { name: 'Labels', exact: true }).click()
      const generation = await canvas.getAttribute('data-map-generation')
      await page
        .getByRole('slider', { name: 'Map scale', exact: true })
        .evaluate((element, value) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )!.set!.call(element, value)
          element.dispatchEvent(new Event('input', { bubbles: true }))
        }, scale)
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
      await expect(canvas).toHaveAttribute('data-ui-hidden', 'true')
      const pixels = await canvasPixels(page)
      expect(pixels.bright).toBeGreaterThan(viewport.width > 760 ? 300 : 50)
      expect(pixels.clipped / Math.max(1, pixels.bright)).toBeLessThan(0.35)
      if (name === 'inside') {
        await expect(canvas).toHaveAttribute(
          'data-galaxy-overview-blend',
          '0.000',
        )
        expect(pixels.clipped / Math.max(1, pixels.bright)).toBeLessThan(0.08)
        expect(pixels.sharpDetail).toBeGreaterThan(
          viewport.width > 760 ? 250 : 30,
        )
      } else {
        expect(
          Number(await canvas.getAttribute('data-galaxy-overview-blend')),
        ).toBeGreaterThan(0.1)
      }
      await page.screenshot({
        path: testInfo.outputPath(`reference-${viewport.width}-${name}.png`),
      })
      await page.getByRole('button', { name: 'Show UI', exact: true }).click()
      const distance = Number(
        await canvas.getAttribute('data-world-distance-pc'),
      )
      await page
        .getByRole('button', { name: 'Display settings', exact: true })
        .click()
      const styles = page.getByRole('group', {
        name: 'Milky Way style',
        exact: true,
      })
      const glints = page.getByRole('checkbox', {
        name: 'Stellar glints',
        exact: true,
      })
      await expect(glints).toBeChecked()
      if (name === 'inside') {
        const accented = await canvasPixels(page)
        await glints.uncheck()
        await expect(canvas).toHaveAttribute('data-galaxy-glints', 'disabled')
        const plain = await canvasPixels(page)
        expect(plain.checksum).not.toBe(accented.checksum)
        await glints.check()
        await expect(canvas).toHaveAttribute(
          'data-galaxy-glints',
          'selective-distance-faded',
        )
        await expect
          .poll(async () => (await canvasPixels(page)).checksum, {
            timeout: 45_000,
          })
          .toBe(accented.checksum)
      }
      await styles
        .getByRole('button', { name: 'Original', exact: true })
        .click()
      await expect(canvas).toHaveAttribute('data-galaxy-style', 'original')
      await expect(glints).toBeDisabled()
      await styles
        .getByRole('button', { name: 'Reference', exact: true })
        .click()
      await expect(canvas).toHaveAttribute('data-galaxy-style', 'reference')
      await expect(canvas).toHaveAttribute('data-map-generation', generation!)
      await expect(canvas).toHaveAttribute('data-following-id', 'milky-way')
      expect(
        Number(await canvas.getAttribute('data-world-distance-pc')),
      ).toBeCloseTo(distance, 7)
      const settingsBounds = (await page
        .locator('.settings-popover')
        .boundingBox())!
      expect(settingsBounds.x).toBeGreaterThanOrEqual(0)
      expect(settingsBounds.y).toBeGreaterThanOrEqual(0)
      expect(settingsBounds.x + settingsBounds.width).toBeLessThanOrEqual(
        viewport.width,
      )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      expect(errors).toEqual([])
    })
  }
}

test('Milky Way particles keep their glow and depth edge-on and in the world map', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.addInitScript(() =>
    localStorage.setItem('hello-world-galaxy-style', 'original'),
  )
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
    await page.goto('/?object=milky-way&view=object')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
    await expect(canvas).toHaveAttribute(
      'data-galaxy-representation',
      'volumetric-particles',
    )
    await expect(canvas).toHaveAttribute('data-galaxy-surface-layers', '0')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page.getByRole('switch', { name: 'Labels', exact: true }).click()
    await expect(page.locator('.celestial-label:visible')).toHaveCount(0)
    const before = await canvasPixels(page)
    await testInfo.attach(`milky-way-colors-${viewport.width}`, {
      body: JSON.stringify(before),
      contentType: 'application/json',
    })
    expect(before.clipped / Math.max(1, before.bright)).toBeLessThan(0.2)
    expect(before.warmStars).toBeGreaterThan(viewport.width > 760 ? 100 : 15)
    expect(before.coolStars).toBeGreaterThan(viewport.width > 760 ? 100 : 15)
    expect(before.pinkRegions).toBeGreaterThan(viewport.width > 760 ? 20 : 3)
    expect(before.colored / Math.max(1, before.bright)).toBeGreaterThan(0.25)
    expect(before.sharpDetail).toBeGreaterThan(viewport.width > 760 ? 250 : 30)
    expect(before.blueRedRatio).toBeGreaterThan(0.85)
    expect(before.blueRedRatio).toBeLessThan(1.4)
    await page.screenshot({
      path: testInfo.outputPath(`milky-way-natural-${viewport.width}.png`),
    })
    const horizontal = viewport.width > 760 ? 680 : 175
    const vertical = viewport.width > 760 ? 555 : 470
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Number(await canvas.getAttribute('data-galaxy-inclination'))
      if (angle > 75 && angle < 85) break
      const movement = Math.max(-0.06, Math.min(0.06, (80 - angle) / 198)) * viewport.height
      await page.mouse.move(horizontal, vertical)
      await page.mouse.down()
      await page.mouse.move(horizontal, vertical - movement, { steps: 4 })
      await page.mouse.up()
      await expect(canvas).toHaveAttribute('data-render-quality', 'full')
    }
    const edge = await canvasPixels(page)
    const inclination = Number(await canvas.getAttribute('data-galaxy-inclination'))
    expect(inclination).toBeGreaterThan(75)
    expect(inclination).toBeLessThan(85)
    expect(edge.bright).toBeGreaterThan(viewport.width > 760 ? 1000 : 100)
    expect(edge.blueRedRatio).toBeGreaterThan(0.85)
    expect(edge.blueRedRatio).toBeLessThan(1.4)
    expect(edge.checksum).not.toBe(before.checksum)
    expect(edge.clipped / Math.max(1, edge.bright)).toBeLessThan(0.35)
    await page.screenshot({
      path: testInfo.outputPath(
        `milky-way-particles-${viewport.width}-edge.png`,
      ),
    })
    const distance = Number(await canvas.getAttribute('data-camera-distance'))
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-camera-distance')),
      )
      .toBeLessThan(distance * 0.9)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    expect((await canvasPixels(page)).bright).toBeGreaterThan(100)
    await page.screenshot({
      path: testInfo.outputPath(
        `milky-way-particles-${viewport.width}-near.png`,
      ),
    })
    await page.getByRole('tab', { name: '3D map', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-map-context', 'unified')
    await expect(canvas).toHaveAttribute('data-following-id', 'milky-way')
    await expect(canvas).toHaveAttribute('data-galaxy-texture-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    const mapPixels = await canvasPixels(page)
    expect(mapPixels.bright).toBeGreaterThan(viewport.width > 760 ? 300 : 50)
    expect(mapPixels.blueRedRatio).toBeGreaterThan(0.85)
    expect(mapPixels.blueRedRatio).toBeLessThan(1.4)
    await page.screenshot({
      path: testInfo.outputPath(
        `milky-way-particles-${viewport.width}-map.png`,
      ),
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  }
})

test('reference detail stays visible while orbiting and zooming on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await page.addInitScript(() =>
    localStorage.setItem('hello-world-galaxy-style', 'original'),
  )
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
          'data-galaxy-representation',
          'volumetric-particles',
        )
        await expect(canvas).toHaveAttribute('data-galaxy-surface-layers', '0')
        await expect(canvas).toHaveAttribute(
          'data-galaxy-texture-ready',
          'true',
        )
        await expect
          .poll(async () =>
            Number(await canvas.getAttribute('data-galaxy-particles')),
          )
          .toBeGreaterThan(100000)
        await expect
          .poll(async () =>
            Number(await canvas.getAttribute('data-galaxy-particle-depth')),
          )
          .toBeGreaterThan(2)
      }
      await page
        .getByRole('button', { name: 'Pause simulation', exact: true })
        .click()
      const pixels = await canvasPixels(page)
      if (id === 'milky-way')
        expect(pixels.clipped / Math.max(1, pixels.bright)).toBeLessThan(0.2)
      expect(pixels.bright, `${id} ${viewport.width}`).toBeGreaterThan(
        viewport.width > 760 ? 1000 : 100,
      )
      if (id === 'milky-way') {
        expect(pixels.blueRedRatio).toBeGreaterThan(0.85)
        expect(pixels.blueRedRatio).toBeLessThan(1.4)
        expect(pixels.colored / Math.max(1, pixels.bright)).toBeGreaterThan(
          0.25,
        )
      } else {
        expect(pixels.colored, `${id} ${viewport.width}`).toBeGreaterThan(
          viewport.width > 760 ? 300 : 40,
        )
      }
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

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
]) {
  test(`clean view hides panels and names without resetting navigation at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize(viewport)
    await page.goto('./?object=earth')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await page
      .getByRole('switch', { name: 'Solar-system orbits', exact: true })
      .click()
    const generation = await canvas.getAttribute('data-map-generation')
    const target = await canvas.getAttribute('data-world-target')
    const distance = Number(await canvas.getAttribute('data-world-distance-pc'))
    await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'true')
    const restore = page.getByRole('button', { name: 'Show UI', exact: true })
    await expect(restore).toBeVisible()
    await expect(restore).toBeFocused()
    for (const selector of [
      '.topbar',
      '.view-layers',
      '.scene-heading',
      '.object-inspector',
      '.timeline',
    ])
      await expect(page.locator(selector)).toBeHidden()
    await expect(
      page.getByRole('textbox', { name: 'Search celestial objects' }),
    ).toBeHidden()
    await expect(page.locator('.celestial-label:visible')).toHaveCount(0)
    await expect(canvas).toHaveAttribute('data-world-target', target!)
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    expect(
      Number(await canvas.getAttribute('data-world-distance-pc')),
    ).toBeCloseTo(distance, 12)
    const bounds = await canvas.boundingBox()
    expect(bounds).toMatchObject({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    })
    const restoreBounds = (await restore.boundingBox())!
    expect(restoreBounds.width).toBeGreaterThanOrEqual(44)
    expect(restoreBounds.height).toBeGreaterThanOrEqual(44)
    expect(restoreBounds.x + restoreBounds.width).toBeLessThanOrEqual(
      viewport.width,
    )
    expect(restoreBounds.y + restoreBounds.height).toBeLessThanOrEqual(
      viewport.height,
    )
    const pixels = await canvasPixels(page)
    expect(pixels.bright).toBeGreaterThan(100)
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.45)
    await page.mouse.down()
    await page.mouse.move(
      viewport.width * 0.5 + 60,
      viewport.height * 0.45 + 25,
      { steps: 4 },
    )
    await page.mouse.up()
    await expect
      .poll(async () => (await canvasPixels(page)).checksum)
      .not.toBe(pixels.checksum)
    await page.keyboard.press('+')
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute('data-world-distance-pc')),
      )
      .toBeLessThan(distance * 0.9)
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await expect(canvas).toHaveAttribute('data-following-id', 'earth')
    await page.screenshot({
      path: testInfo.outputPath(`clean-view-earth-${viewport.width}.png`),
    })
    const zoomed = Number(await canvas.getAttribute('data-world-distance-pc'))
    await restore.click()
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'false')
    await expect(
      page.getByRole('switch', { name: 'Solar-system orbits', exact: true }),
    ).toHaveAttribute('aria-checked', 'false')
    await expect(
      page.getByRole('switch', { name: 'Labels', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      Number(await canvas.getAttribute('data-world-distance-pc')),
    ).toBeCloseTo(zoomed, 12)
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    await page.getByRole('tab', { name: 'Close-up', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page.getByRole('switch', { name: 'Labels', exact: true }).click()
    const localDistance = Number(
      await canvas.getAttribute('data-camera-distance'),
    )
    await page.keyboard.press('h')
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'true')
    expect(
      Number(await canvas.getAttribute('data-camera-distance')),
    ).toBeCloseTo(localDistance, 6)
    await page.keyboard.press('Escape')
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'false')
    await expect(
      page.getByRole('switch', { name: 'Labels', exact: true }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      Number(await canvas.getAttribute('data-camera-distance')),
    ).toBeCloseTo(localDistance, 6)
    if (viewport.width > 760) {
      const search = page.getByRole('textbox', {
        name: 'Search celestial objects',
      })
      await search.fill('')
      await search.pressSequentially('ho')
      await expect(search).toHaveValue('ho')
      await expect(canvas).toHaveAttribute('data-ui-hidden', 'false')
      await expect(
        page.getByRole('switch', { name: 'Solar-system orbits', exact: true }),
      ).toHaveAttribute('aria-checked', 'false')
    }
    await expect(page.locator('.universe-canvas canvas')).toHaveCount(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`solar-system orbit and name layers toggle without moving the camera at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    await page.goto('./?object=solar-system')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    const target = await canvas.getAttribute('data-world-target')
    const generation = await canvas.getAttribute('data-map-generation')
    const labels = page.getByRole('switch', { name: 'Labels', exact: true })
    await expect(page.locator('.celestial-label:visible').first()).toBeVisible()
    await labels.click()
    await expect(labels).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.celestial-label:visible')).toHaveCount(0)
    const orbits = page.getByRole('switch', {
      name: 'Solar-system orbits',
      exact: true,
    })
    await expect(orbits).toHaveAttribute('aria-checked', 'true')
    await expect(canvas).toHaveAttribute('data-minor-orbit-state', 'ready', {
      timeout: 60_000,
    })
    const withOrbits = await canvasPixels(page)
    await orbits.click()
    await expect(orbits).toHaveAttribute('aria-checked', 'false')
    await expect
      .poll(async () => (await canvasPixels(page)).bright)
      .toBeLessThan(withOrbits.bright)
    await page.screenshot({
      path: testInfo.outputPath(
        `solar-system-no-overlays-${viewport.width}.png`,
      ),
    })
    await orbits.click()
    await expect
      .poll(async () => (await canvasPixels(page)).bright)
      .toBeGreaterThanOrEqual(withOrbits.bright * 0.95)
    await expect(canvas).toHaveAttribute('data-world-target', target!)
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    await page.screenshot({
      path: testInfo.outputPath(`solar-system-orbits-${viewport.width}.png`),
    })
    await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'true')
    const cleanOrbits = await canvasPixels(page)
    await page.keyboard.press('o')
    await expect
      .poll(async () => (await canvasPixels(page)).bright)
      .toBeLessThan(cleanOrbits.bright)
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'true')
    await expect(page.locator('.celestial-label:visible')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(canvas).toHaveAttribute('data-ui-hidden', 'false')
    await expect(orbits).toHaveAttribute('aria-checked', 'false')
    await expect(labels).toHaveAttribute('aria-checked', 'false')
    await labels.click()
    await expect(page.locator('.celestial-label:visible').first()).toBeVisible()
  })
}

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`all cataloged solar-system families have batched orbit paths at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setViewportSize(viewport)
    await page.goto('./?object=solar-system')
    const canvas = page.locator('.universe-canvas canvas')
    await expect(canvas).toHaveAttribute('data-catalog-ready', 'true')
    await expect(canvas).toHaveAttribute('data-flying', 'false')
    await page
      .getByRole('button', { name: 'Pause simulation', exact: true })
      .click()
    await expect(canvas).toHaveAttribute('data-minor-orbit-state', 'ready', {
      timeout: 60_000,
    })
    const counts = JSON.parse(
      (await canvas.getAttribute('data-solar-orbit-counts'))!,
    ) as Record<string, number>
    expect(counts.planet).toBe(8)
    expect(counts.moon).toBe(9)
    expect(counts.spacecraft).toBe(3)
    expect(counts['dwarf-planet']).toBe(5)
    expect(counts.asteroid).toBeGreaterThan(4900)
    expect(counts.comet).toBeGreaterThan(4000)
    await testInfo.attach('orbit-coverage', {
      body: JSON.stringify(counts),
      contentType: 'application/json',
    })
    expect(
      Number(await canvas.getAttribute('data-orbit-draw-calls')),
    ).toBeLessThanOrEqual(24)
    const generation = await canvas.getAttribute('data-map-generation')
    const target = await canvas.getAttribute('data-world-target')
    await page.getByRole('switch', { name: 'Labels', exact: true }).click()
    const orbits = page.getByRole('switch', {
      name: 'Solar-system orbits',
      exact: true,
    })
    const withOrbits = await canvasPixels(page)
    expect(withOrbits.clipped / Math.max(1, withOrbits.bright)).toBeLessThan(
      0.15,
    )
    await page.screenshot({
      path: testInfo.outputPath(
        `all-solar-system-orbits-${viewport.width}.png`,
      ),
    })
    await orbits.click()
    await expect(canvas).toHaveAttribute('data-orbit-draw-calls', '0')
    await expect
      .poll(async () => (await canvasPixels(page)).bright)
      .toBeLessThan(withOrbits.bright)
    await orbits.click()
    await expect(canvas).toHaveAttribute('data-minor-orbit-state', 'ready')
    await expect(canvas).toHaveAttribute('data-world-target', target!)
    await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    const search = page.getByRole('textbox', {
      name: 'Search celestial objects',
    })
    for (const name of ['Pluto', 'Halley', 'Vesta']) {
      if (viewport.width < 760)
        await page
          .getByRole('button', { name: 'Open object catalog', exact: true })
          .click()
      await search.fill(name)
      await page.locator('.catalog-scroll .catalog-object').first().click()
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      const id = await canvas.getAttribute('data-scene')
      await page
        .getByRole('slider', { name: 'Map scale', exact: true })
        .evaluate((element) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )!.set!.call(element, -3)
          element.dispatchEvent(new Event('input', { bubbles: true }))
        })
      await expect(canvas).toHaveAttribute('data-flying', 'false')
      await expect(canvas).toHaveAttribute('data-selected-orbit-id', id!)
      await expect(canvas).toHaveAttribute('data-map-generation', generation!)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  })
}

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
  expect((await download).suggestedFilename()).toContain('hello-world-earth')
})
