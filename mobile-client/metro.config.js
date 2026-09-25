// Metro no monorepo: por padrão o Expo monitora todas as pastas do workspace (API, portal, painel e o
// `.next` que o `next dev` reescreve sem parar). O app só usa os pacotes abaixo; vigiar menos pastas deixa
// a inicialização rápida e evita que mudanças alheias ao app derrubem o mapa de dependências.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const workspaceRoot = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [__dirname, ...['node_modules', 'mobile-kit', 'shared'].map((dir) => path.join(workspaceRoot, dir))];

module.exports = config;
