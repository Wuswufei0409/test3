import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {baseURL: 'http://127.0.0.1:4173', viewport: {width: 1280,height: 720}},
  webServer: {command: 'npm run preview -- --port 4173', port: 4173, reuseExistingServer: true}
});
