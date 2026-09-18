// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: 'list'
});
