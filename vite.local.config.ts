import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./local', import.meta.url)),
  base: './',
  resolve: {alias: {'@':fileURLToPath(new URL('.',import.meta.url))}},
  plugins: [react()],
  css: {postcss:{plugins:[tailwindcss()]}},
  build: {outDir:'../local-dist',emptyOutDir:true,cssCodeSplit:false,rollupOptions:{output:{inlineDynamicImports:true}}},
});
