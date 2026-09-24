// Módulos nativos sem implementação no ambiente de testes (Node).
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
