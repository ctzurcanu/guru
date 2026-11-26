import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://ctzurcanu.github.io/guru/
export default defineConfig({
  base: '/guru/',
  plugins: [react()],
});
