export default {
  testDir: '.', testMatch: 'live-widget.spec.mjs', timeout: 180000,
  testIgnore: '**/original-final-review/**',
  workers: 1, reporter: 'list', retries: 0,
  outputDir: './browser-results',
  use: { headless: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow', trace: 'off', screenshot: 'off' },
};
