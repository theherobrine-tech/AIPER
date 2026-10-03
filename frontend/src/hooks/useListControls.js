import { useState, useMemo, useCallback } from 'react';
import { resolveSiblings, jobCodeComparator } from '../utils/siblingUtils';

export function useListControls(rawItems, config, options = {}) {
  const {
    defaultSortKey = 'createdAt',
    defaultSortDir = 'desc',
    sortOptions = [],
    filterDefs = [],
  } = config;

  const {
    getSiblingId,
    fullItems = [],
    groupRoots,
    fuse
  } = options;

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState(defaultSortDir);
  const [activeFilters, setActiveFilters] = useState({});

  const setFilter = useCallback((filterId, value, mode = 'include') => {
    setActiveFilters(prev => ({
      ...prev,
      [filterId]: { value, mode }
    }));
  }, []);

  const clearFilter = useCallback((filterId) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      delete next[filterId];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setSearchQuery('');
    setSortKey(defaultSortKey);
    setSortDir(defaultSortDir);
    setActiveFilters({});
  }, [defaultSortKey, defaultSortDir]);

  const toggleSortDir = useCallback(() => {
    setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
  }, []);

  const processedItems = useMemo(() => {
    let filtered = [...rawItems];

    // If search is active and fuse instance provided, search over it instead of rawItems
    if (searchQuery && fuse) {
      filtered = fuse.search(searchQuery).map(r => r.item);
    }

    if (!filtered || filtered.length === 0) return [];

    // Apply Filters (AND logic)
    const activeFilterEntries = Object.entries(activeFilters);
    if (activeFilterEntries.length > 0) {
      filtered = filtered.filter(item => {
        for (const [filterId, filterState] of activeFilterEntries) {
          const def = filterDefs.find(d => d.id === filterId);
          if (def && def.test) {
            const passed = def.test(item, filterState.value);
            if (filterState.mode === 'exclude') {
              if (passed) return false;
            } else {
              if (!passed) return false;
            }
          }
        }
        return true;
      });
    }

    // Sibling Pull-in / Root Grouping
    if (getSiblingId) {
      filtered = resolveSiblings(filtered, fullItems, getSiblingId);
    } else if (groupRoots) {
      const roots = new Set(filtered.map(i => groupRoots(i)).filter(Boolean));
      if (roots.size > 0 && fullItems && fullItems.length > 0) {
        const expanded = [];
        const seen = new Set();
        for (const item of fullItems) {
          const root = groupRoots(item);
          if (root && roots.has(root) && !seen.has(item._id)) {
            expanded.push(item);
            seen.add(item._id);
          }
        }
        filtered = expanded;
      }
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortKey === 'jobCode' || sortKey === 'testCode') {
        const aCode = a.jobCode || a.testCode;
        const bCode = b.jobCode || b.testCode;
        return jobCodeComparator(aCode, bCode, sortDir);
      }

      const aVal = a[sortKey];
      const bVal = b[sortKey];

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [rawItems, activeFilters, sortKey, sortDir, filterDefs, fullItems, getSiblingId, groupRoots]);

  const isFiltered = searchQuery !== '' || Object.keys(activeFilters).length > 0;

  return {
    searchQuery, setSearchQuery,
    sortKey, setSortKey,
    sortDir, setSortDir, toggleSortDir,
    activeFilters, setFilter, clearFilter, clearAll,
    processedItems,
    isFiltered,
    resultCount: processedItems.length
  };
}
