module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
  },
  testMatch: [
    '**/__tests__/auth.test.ts',
    '**/__tests__/module123.test.ts',
    '**/__tests__/module4.test.ts',
    '**/__tests__/module5.test.ts',
    '**/__tests__/module6.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
