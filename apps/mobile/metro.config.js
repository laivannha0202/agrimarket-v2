// Metro for a workspace package inside an npm-workspaces monorepo.
//
// The app imports `@agrimarket/shared-domain/*` and `@agrimarket/design-tokens`,
// which live in `packages/` and are linked into the ROOT `node_modules`. Metro
// only serves files under `projectRoot` plus `watchFolders`, so without this
// config every one of those imports fails with
//
//   Unable to resolve module @agrimarket/shared-domain/home
//
// and `expo export` cannot produce a bundle at all. This is the configuration
// documented by Expo for monorepos; it changes nothing about the app itself.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits in packages/* trigger a rebuild.
config.watchFolders = [workspaceRoot];

// Resolve modules from the app first, then from the hoisted root store.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The shared packages expose TypeScript sources through `exports` subpaths
// (`./home`, `./checkout`, ...), which requires package-exports resolution.
config.resolver.unstable_enablePackageExports = true;

// Belt and braces: even with package exports on, Metro resolves a symlinked
// workspace package to its real path and then looks for `<real>/home` as a
// file. Pointing the package names straight at `src/` makes both the bare
// import (`src/index.ts`) and every subpath (`src/home.ts`) resolve without
// depending on how the resolver handles `exports`.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@agrimarket/shared-domain': path.resolve(workspaceRoot, 'packages/shared-domain/src'),
  '@agrimarket/design-tokens': path.resolve(workspaceRoot, 'packages/design-tokens/src'),
};

module.exports = config;
