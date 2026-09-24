/**
 * Dois projetos:
 * - unit: regras de negócio isoladas (src/**\/*.spec.ts), sem banco.
 * - e2e : API + PostgreSQL real (test/**\/*.e2e-spec.ts). Requer o banco `levoja_test`
 *         (docker compose ou `pnpm db:embedded`).
 */
// Transpilação isolada (rápida); a checagem de tipos é feita separadamente por `pnpm typecheck`.
const tsJest = ['ts-jest', { tsconfig: 'tsconfig.spec.json', diagnostics: false }];

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
  // Opção global (não é aplicada dentro de "projects"): fluxos E2E aguardam despacho e filas.
  testTimeout: 60_000,
};
