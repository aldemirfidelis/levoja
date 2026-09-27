// Metro no monorepo: pastas vigiadas e pacotes ignorados ficam em mobile-kit/metro-config.js
// (compartilhado com o outro app). METRO_WATCH_ALL=1 desliga o filtro de pacotes.
const { getDefaultConfig } = require('expo/metro-config');
const { withMonorepo } = require('../mobile-kit/metro-config');

module.exports = withMonorepo(getDefaultConfig(__dirname), __dirname);
