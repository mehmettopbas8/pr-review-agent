import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        // Force these CJS modules through Vitest's transform so vi.mock() intercepts them
        inline: ['@octokit/rest', '@octokit/auth-app'],
      },
    },
  },
});
