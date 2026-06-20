import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/server.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  globals: {
    'ts-jest': {
      tsconfig: { strict: false },
    },
  },
  // Ensure tests don't linger open handles
  forceExit: true,
  detectOpenHandles: true,
};

export default config;
