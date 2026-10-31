// Metro가 앱 루트 밖의 공용 계약(../../shared/src)을 번들링할 수 있도록 watchFolders에 추가한다.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../../shared');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];
// shared/ 에는 node_modules가 없으므로 앱의 node_modules에서 의존성을 찾게 한다.
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.resolve(projectRoot, 'node_modules'),
];

module.exports = config;
