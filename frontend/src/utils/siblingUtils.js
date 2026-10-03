export function resolveSiblings(filteredItems, fullItems, getSiblingId) {
  if (!getSiblingId) return filteredItems;
  if (!fullItems || fullItems.length === 0) return filteredItems;

  const resultSet = new Set(filteredItems.map(i => i._id));
  const expanded = [...filteredItems];

  const fullItemMap = new Map();
  for (const item of fullItems) {
    fullItemMap.set(item._id, item);
  }

  for (const item of filteredItems) {
    const siblingId = getSiblingId(item);
    if (siblingId && !resultSet.has(siblingId) && fullItemMap.has(siblingId)) {
      expanded.push(fullItemMap.get(siblingId));
      resultSet.add(siblingId);
    }
  }

  return expanded;
}

export function testCodeRoot(tc) {
  if (!tc) return '';
  return tc.replace(/-[12][a-z]$/, '');
}

export function jobCodeComparator(aCode, bCode, dir) {
  if (!aCode && !bCode) return 0;
  if (!aCode) return 1;
  if (!bCode) return -1;

  const getRoot = (code) => {
    let rootStr = testCodeRoot(code); // remove suffix if it's a testCode
    if (rootStr.endsWith('-N')) {
      rootStr = rootStr.slice(0, -2);
    }
    return rootStr;
  };

  const rootA = getRoot(aCode);
  const rootB = getRoot(bCode);

  let rootCompare = 0;
  if (rootA < rootB) rootCompare = -1;
  if (rootA > rootB) rootCompare = 1;

  if (rootCompare !== 0) {
    return dir === 'asc' ? rootCompare : -rootCompare;
  }

  const isNonNablA = aCode.includes('-N');
  const isNonNablB = bCode.includes('-N');

  if (isNonNablA === isNonNablB) return 0;

  if (dir === 'asc') {
    return isNonNablA ? 1 : -1;
  } else {
    return isNonNablA ? -1 : 1;
  }
}
