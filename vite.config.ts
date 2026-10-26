import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages hosts project builds at /FaxingPro/.
// Electron file:// builds must retain the normal relative base.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || './',
  server: { port: 4173 },
});
