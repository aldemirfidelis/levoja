// Metro no monorepo (usado pelo metro.config.js de mobile-client e mobile-driver).
//
// Por padrão o Expo monitora todas as pastas do workspace (API, portal, painel e o `.next` que o
// `next dev` reescreve sem parar); aqui o app vigia só a própria pasta, o `node_modules` da raiz e os
// pacotes compartilhados que usa.
//
// No `node_modules` da raiz (node-linker=hoisted) ficam também as dependências da API e do portal
// (Next, Nest, AWS SDK, Prisma…). No Windows o Metro cria um monitor por pasta e, com tudo isso, a
// inicialização passava dos 240 s do limite ("Failed to start watch mode"): o Metro ficava de pé,
// mas cada bundle respondia 500. Por isso os pacotes que os apps não usam (fora da árvore de
// dependências de mobile-client, mobile-driver, mobile-kit e shared) entram no `blockList`, e no
// Windows o watcher não segura mais a inicialização (ver startWatcherInBackground).
// METRO_WATCH_ALL=1 desliga os dois ajustes, se algum dia faltar um pacote.
const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const rootModules = path.join(workspaceRoot, 'node_modules');
const APP_PACKAGES = ['mobile-client', 'mobile-driver', 'mobile-kit', 'shared'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function dependencyNames(pkg) {
  if (!pkg) return [];
  return [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].flatMap((group) => Object.keys(group ?? {}));
}

/**
 * Ferramentas que rodam só no Node (depurador, Gradle): nunca entram no bundle do app. O @expo/cli
 * não entra aqui: o `require` do bundle (build/metro-require) vem dele.
 */
const TOOLING_ONLY = ['@react-native/debugger-frontend', '@react-native/gradle-plugin'];

/** Pastas de código nativo (Kotlin, Objective-C, C++) na raiz dos pacotes: o Metro não as empacota. */
const NATIVE_DIRS = ['android', 'ios'];
const REACT_NATIVE_NATIVE_DIRS = ['ReactAndroid', 'ReactCommon', 'React', 'ReactApple', 'sdks', 'third-party-podspecs', 'gradle'];

/** Pacotes instalados dentro de `<pasta>/node_modules` (versões aninhadas), com escopos. */
function nestedPackages(dir) {
  const modules = path.join(dir, 'node_modules');
  let entries;
  try {
    entries = fs.readdirSync(modules);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (name.startsWith('.')) return [];
    if (!name.startsWith('@')) return [path.join(modules, name)];
    try {
      return fs.readdirSync(path.join(modules, name)).map((sub) => path.join(modules, name, sub));
    } catch {
      return [];
    }
  });
}

/** Nomes de todos os pacotes alcançáveis a partir dos apps (dependências, peers e opcionais). */
function packagesUsedByApps() {
  const used = new Set();
  const queue = [];
  const visitDir = (dir) => {
    for (const name of dependencyNames(readJson(path.join(dir, 'package.json')))) {
      if (!used.has(name)) {
        used.add(name);
        queue.push(name);
      }
    }
    // Versões aninhadas também podem depender de pacotes que só existem na raiz.
    for (const nested of nestedPackages(dir)) visitDir(nested);
  };
  // O mobile-kit declara expo, react-native etc. como peerDependencies (já incluídas).
  for (const app of APP_PACKAGES) visitDir(path.join(workspaceRoot, app));
  while (queue.length) visitDir(path.join(rootModules, queue.pop()));
  return used;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex que bloqueia, na raiz do `node_modules`, os pacotes que os apps não usam, as ferramentas só
 * de Node e as pastas de código nativo dos pacotes.
 */
function unusedPackagesBlockList() {
  const used = packagesUsedByApps();
  const unused = [...TOOLING_ONLY];
  for (const name of fs.readdirSync(rootModules)) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(rootModules, name))) if (!used.has(`${name}/${sub}`)) unused.push(`${name}/${sub}`);
    } else if (!used.has(name)) {
      unused.push(name);
    }
  }
  // O Metro testa caminhos absolutos: a indexação com "\" e o watcher com "/" (no Windows). A letra
  // do disco pode vir minúscula; o Metro junta todos os padrões num só e exige as mesmas flags, então
  // em vez de "i" a raiz aceita as duas caixas letra a letra.
  const sep = '[\\\\/]';
  const anyCase = (text) => escapeRegExp(text).replace(/[a-z]/gi, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
  const root = rootModules.split(/[\\/]/).map(anyCase).join(sep);
  const names = unused.map((name) => name.split('/').map(escapeRegExp).join(sep)).join('|');
  const pkg = `(?:@[^\\\\/]+${sep})?[^\\\\/]+`;
  const native = `${pkg}${sep}(?:${NATIVE_DIRS.join('|')})|react-native${sep}(?:${REACT_NATIVE_NATIVE_DIRS.join('|')})`;
  return new RegExp(`^${root}${sep}(?:${names}|${native})(?:${sep}.*)?$`);
}

/**
 * Windows: o watcher do Metro registra um monitor por pasta antes de liberar a inicialização e
 * desiste após 240 s ("Failed to start watch mode"). Com o disco frio (logo depois de ligar o
 * notebook) isso acontece mesmo com o filtro de pacotes. A lista de arquivos do app vem da indexação,
 * não do watcher, então aqui ele registra as pastas em segundo plano, sem segurar a inicialização.
 * Efeito colateral: alterações numa pasta ainda não registrada, nos primeiros minutos, não recarregam
 * o app (irrelevante no node_modules; as pastas do app são registradas em segundos).
 */
function startWatcherInBackground() {
  if (process.platform !== 'win32') return;
  let FallbackWatcher;
  try {
    FallbackWatcher = require(path.join(path.dirname(require.resolve('@expo/metro-file-map')), 'watchers', 'FallbackWatcher.js')).default;
  } catch {
    return;
  }
  if (!FallbackWatcher || FallbackWatcher.startsInBackground) return;
  const startWatching = FallbackWatcher.prototype.startWatching;
  FallbackWatcher.prototype.startWatching = function startWatchingInBackground() {
    startWatching.call(this).catch((error) => this.emitError(error));
    return Promise.resolve();
  };
  FallbackWatcher.startsInBackground = true;
}

/** Aplica ao config do Expo as pastas vigiadas e o filtro de pacotes do monorepo. */
function withMonorepo(config, projectRoot) {
  config.watchFolders = [projectRoot, ...['node_modules', 'mobile-kit', 'shared'].map((dir) => path.join(workspaceRoot, dir))];
  if (process.env.METRO_WATCH_ALL !== '1') {
    startWatcherInBackground();
    const block = unusedPackagesBlockList();
    if (block) {
      const current = config.resolver.blockList;
      config.resolver.blockList = [...(Array.isArray(current) ? current : current ? [current] : []), block];
    }
  }
  return config;
}

module.exports = { withMonorepo, packagesUsedByApps };
