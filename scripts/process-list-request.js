// Parse a "名单变更申请" issue and update config.js accordingly.
// Expected issue body (from the YAML form):
//   ### 名单类型\n\nGitHub 仓库白名单\n\n### 条目\n\nowner/repo\n\n### 申请理由\n\n...\n
//
// This script reads config.js, adds the entries to the correct list,
// sorts the list, and writes it back.

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.js');

// --- Parse issue body ---
const body = process.env.ISSUE_BODY || '';
const issueNumber = process.env.ISSUE_NUMBER || '0';
const issueUser = process.env.ISSUE_USER || '';

function extractField(label) {
  // Match "### Label\n\nvalue" — the YAML form uses ### headings
  const re = new RegExp(`### ${label}\\s*\\n\\n([\\s\\S]*?)(?=\\n###|$)`);
  const m = body.match(re);
  if (!m) return '';
  return m[1].trim();
}

const listType = extractField('名单类型');
const itemsRaw = extractField('条目');

if (!listType || !itemsRaw) {
  console.log('Could not parse list type or items from issue body, skipping.');
  process.exit(0);
}

const items = itemsRaw
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0);

if (items.length === 0) {
  console.log('No valid items found, skipping.');
  process.exit(0);
}

// --- Map list type to config keys ---
// listType format: "GitHub 仓库白名单", "npm 包黑名单", "扩展名白名单", etc.
const typeMap = {
  'GitHub 仓库白名单': { arrayKey: 'GITHUB_REPOS.whitelist', modeKey: 'GITHUB_REPOS_MODE', modeValue: 'whitelist' },
  'GitHub 仓库黑名单': { arrayKey: 'GITHUB_REPOS.blacklist', modeKey: 'GITHUB_REPOS_MODE', modeValue: 'blacklist' },
  'npm 包白名单':      { arrayKey: 'NPM_PACKAGES.whitelist',  modeKey: 'NPM_PACKAGES_MODE',  modeValue: 'whitelist' },
  'npm 包黑名单':      { arrayKey: 'NPM_PACKAGES.blacklist',  modeKey: 'NPM_PACKAGES_MODE',  modeValue: 'blacklist' },
  '站点白名单':        { arrayKey: 'SITES.whitelist',         modeKey: 'SITES_MODE',         modeValue: 'whitelist' },
  '站点黑名单':        { arrayKey: 'SITES.blacklist',         modeKey: 'SITES_MODE',         modeValue: 'blacklist' },
  '扩展名白名单':      { arrayKey: 'EXTENSIONS_WHITELIST',    modeKey: 'EXTENSIONS_MODE',    modeValue: 'whitelist' },
  '扩展名黑名单':      { arrayKey: 'EXTENSIONS_BLACKLIST',    modeKey: 'EXTENSIONS_MODE',    modeValue: 'blacklist' },
};

const mapping = typeMap[listType];
if (!mapping) {
  console.log(`Unknown list type: "${listType}", skipping.`);
  process.exit(0);
}

// --- Read and update config.js ---
let configContent = fs.readFileSync(configPath, 'utf8');

// 1. Update the mode if it's currently 'none'
const modeRegex = new RegExp(`(${mapping.modeKey}\\s*:\\s*)'\\w+'`);
const currentMode = configContent.match(modeRegex);
if (currentMode) {
  const existingMode = currentMode[0].match(/'(\w+)'/)[1];
  if (existingMode === 'none') {
    configContent = configContent.replace(modeRegex, `$1'${mapping.modeValue}'`);
    console.log(`Updated ${mapping.modeKey} from 'none' to '${mapping.modeValue}'`);
  } else if (existingMode !== mapping.modeValue) {
    // Mode conflict: e.g. currently 'blacklist' but requesting 'whitelist'
    console.log(`WARNING: ${mapping.modeKey} is '${existingMode}', but request is for '${mapping.modeValue}'. Skipping mode change.`);
  }
}

// 2. Add items to the target array
// Find the array in config.js and append items (dedup)
const arrayKeyParts = mapping.arrayKey.split('.');
let arrayRegex;

if (arrayKeyParts.length === 2) {
  // e.g. GITHUB_REPOS.whitelist -> look for "whitelist: [\n...]"
  // We need the one inside the correct parent block
  // Strategy: find the parent block first, then the array inside it
  const parentKey = arrayKeyParts[0]; // e.g. GITHUB_REPOS
  const childKey = arrayKeyParts[1];  // e.g. whitelist

  // Find parent block: GITHUB_REPOS: {
  const parentStart = configContent.indexOf(parentKey + ':');
  if (parentStart === -1) {
    console.log(`Could not find ${parentKey} in config.js`);
    process.exit(1);
  }

  // Find the opening brace after parentKey
  const braceStart = configContent.indexOf('{', parentStart);
  let depth = 0;
  let parentEnd = braceStart;
  for (let i = braceStart; i < configContent.length; i++) {
    if (configContent[i] === '{') depth++;
    if (configContent[i] === '}') {
      depth--;
      if (depth === 0) { parentEnd = i; break; }
    }
  }

  const parentBlock = configContent.substring(braceStart, parentEnd + 1);

  // Find the child array inside the parent block
  const childRegex = new RegExp(`(${childKey}\\s*:\\s*\\[)([\\s\\S]*?)(\\])`);
  const childMatch = parentBlock.match(childRegex);
  if (!childMatch) {
    console.log(`Could not find ${childKey} array inside ${parentKey}`);
    process.exit(1);
  }

  // Parse existing items
  const existingItems = childMatch[2]
    .split('\n')
    .map(line => line.trim().replace(/,\s*$/, '').replace(/'/g, '').replace(/"/g, ''))
    .filter(line => line.length > 0);

  // Add new items (dedup)
  const existingSet = new Set(existingItems.map(i => i.toLowerCase()));
  const newItems = items.filter(item => !existingSet.has(item.toLowerCase()));

  if (newItems.length === 0) {
    console.log('All items already exist in the list, no changes needed.');
    process.exit(0);
  }

  const allItems = [...existingItems, ...newItems].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const newArrayContent = allItems.map(item => `            '${item}'`).join(',\n');

  const newChildBlock = `${childKey}: [\n${newArrayContent}\n        ]`;
  const updatedParentBlock = parentBlock.replace(childRegex, newChildBlock);

  configContent = configContent.substring(0, braceStart) + updatedParentBlock + configContent.substring(parentEnd + 1);

} else if (arrayKeyParts.length === 1) {
  // e.g. EXTENSIONS_WHITELIST -> top-level array
  const key = arrayKeyParts[0];
  arrayRegex = new RegExp(`(${key}\\s*:\\s*\\[)([\\s\\S]*?)(\\])`);
  const match = configContent.match(arrayRegex);
  if (!match) {
    console.log(`Could not find ${key} in config.js`);
    process.exit(1);
  }

  const existingItems = match[2]
    .split('\n')
    .map(line => line.trim().replace(/,\s*$/, '').replace(/'/g, '').replace(/"/g, ''))
    .filter(line => line.length > 0);

  const existingSet = new Set(existingItems.map(i => i.toLowerCase()));
  const newItems = items.filter(item => !existingSet.has(item.toLowerCase()));

  if (newItems.length === 0) {
    console.log('All items already exist in the list, no changes needed.');
    process.exit(0);
  }

  const allItems = [...existingItems, ...newItems].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const newArrayContent = allItems.map(item => `        '${item}'`).join(',\n');

  configContent = configContent.replace(arrayRegex, `${key}: [\n${newArrayContent}\n    ]`);
}

// --- Write back ---
fs.writeFileSync(configPath, configContent, 'utf8');
console.log(`Added ${items.length} item(s) to ${mapping.arrayKey} (issue #${issueNumber} by @${issueUser})`);
items.forEach(item => console.log(`  + ${item}`));
