import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'include-methods',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'README.md', source: readFileSync('README.md') });
    }
  }]
});

