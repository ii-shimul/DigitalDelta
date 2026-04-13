const reactNativePreset = require('@react-native/jest-preset');

module.exports = {
  ...reactNativePreset,
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [],
};
