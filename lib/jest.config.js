// eslint-disable-next-line import/no-commonjs
module.exports = {
  testMatch: ['**/?(*.)+(spec|test).+(ts|tsx|js)'],
  // Allow esbuild-jest to transform ESM-only packages (e.g. package-manager-detector)
  transformIgnorePatterns: ['node_modules/(?!.*package-manager-detector)'],
  transform: {
    '^.+\\.(tsx?|json?|mjs)$': [
      'esbuild-jest',
      {
        sourcemap: true, // correct line numbers in code coverage
        loaders: { '.mjs': 'js' },
      },
    ],
  },
  coverageReporters: ['text'],
  collectCoverage: true,
  collectCoverageFrom: [
    './src/**',
    // Pure type definitions — no executable statements to cover
    '!./src/types.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 80,
    },
  },
};
