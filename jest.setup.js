global.IS_REACT_ACT_ENVIRONMENT = true;
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

global.__DEV__ = true;
global.window = global;
global.requestAnimationFrame = callback =>
  setTimeout(() => callback(Date.now()), 0);
global.cancelAnimationFrame = id => clearTimeout(id);
global.performance = global.performance ?? {
  now: () => Date.now(),
};

global.__fbBatchedBridgeConfig = global.__fbBatchedBridgeConfig ?? {
  remoteModuleConfig: [],
};

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');

  return {
    SafeAreaProvider: ({ children }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children }) =>
      React.createElement(React.Fragment, null, children),
  };
});
