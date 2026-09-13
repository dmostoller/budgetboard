import { defineConfig } from 'vite-plus'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({
      router: {
        // @ts-expect-error -- autoCodeSplitting is the stable flag at runtime,
        // but @tanstack/start-plugin-core's types still only expose the old
        // experimental.enableCodeSplitting name.
        autoCodeSplitting: true,
      },
    }),
    // Nitro picks its own preset from the host: `vercel` when Vercel sets
    // VERCEL=1 during the build, `node-server` locally.
    nitroV2Plugin({
      compatibilityDate: '2026-09-13',
      externals: {
        // Better Auth reaches into subpath exports (`@better-auth/utils/random`
        // and friends) that Nitro's dependency tracing does not follow, which
        // leaves the deployed server throwing ERR_MODULE_NOT_FOUND. Bundling
        // them in sidesteps the tracing entirely.
        inline: ['better-auth', '@better-auth/utils'],
      },
    }),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],

  // Vitest
  test: {
    // convex-test runs the Convex functions in a Convex-like runtime
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: ['{convex,src}/**/*.test.ts'],
  },

  // Oxlint
  lint: {
    options: {
      // Type-aware rules and TypeScript checking, so `vp check` is the one
      // command that covers format, lint and types.
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: [
      'convex/_generated/**',
      'src/routeTree.gen.ts',
      '.agents/**',
      '.claude/**',
      '.nitro/**',
      '.output/**',
      '.vercel/**',
      'dist/**',
    ],
  },

  // Oxfmt
  fmt: {
    ignorePatterns: [
      // Rewritten by `tsr generate`; formatting it only creates churn on the
      // next regeneration.
      'src/routeTree.gen.ts',
      'convex/_generated/**',
      // Agent skills and guidelines installed by `convex dev` — vendor files,
      // not ours to restyle.
      '.agents/**',
      '.claude/**',
      'AGENTS.md',
    ],
    semi: false,
    singleQuote: true,
  },
})

export default config
