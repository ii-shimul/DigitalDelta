/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../src/ui/navigation', () => ({
  AuthFlow: () => null,
}));

jest.mock('react-native', () => {
  const React = require('react');

  return {
    ActivityIndicator: 'ActivityIndicator',
    StatusBar: () => null,
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light',
  };
});

jest.mock('../src/utils/manualDemoSetup', () => ({
  runManualDemoSetup: jest.fn().mockResolvedValue({
    loginData: {},
    dashboardData: {},
  }),
}));

import App from '../App';

test('renders correctly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  expect(tree!).toBeTruthy();
});
