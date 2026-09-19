import { defineConfig } from '@playwright/test'

const deploymentBase = process.env.DEPLOY_BASE_PATH || '/'
const previewPort = process.env.PREVIEW_PORT || '4179'
const previewUrl = `http://127.0.0.1:${previewPort}${deploymentBase}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: previewUrl,
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run build -- --base ${deploymentBase} --logLevel warn && npm run preview -- --base ${deploymentBase} --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: false,
  },
})
