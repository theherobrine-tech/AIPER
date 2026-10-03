import axios from 'axios';
import { cacheGet, cacheSet, cacheDel, isCached } from './cacheStorage';

/**
 * Fetches data using a Stale-While-Revalidate strategy.
 * 1. Show cached data instantly (if available)
 * 2. Fetch fresh data from the server
 * 3. Update the UI + write fresh data back to cache
 *
 * Storage backend (IndexedDB vs sessionStorage) is chosen automatically
 * based on the cache key — see cacheStorage.js for the mapping.
 */
export async function fetchWithCache(url, cacheKey, setter, headers = {}, { cache = true } = {}) {
  // Step 1: Instantly render from cache if available
  if (cache && cacheKey) {
    try {
      const cached = await cacheGet(cacheKey);
      if (cached !== null && typeof cached === 'object') {
        setter(cached);
      }
    } catch (e) {
      await cacheDel(cacheKey);
    }
  }

  // Step 2: Fetch fresh data from the server
  const res = await axios.get(url, { headers });

  // Step 3: Update the UI with fresh data
  if (res.data !== null && typeof res.data === 'object') {
    setter(res.data);

    // Step 4: Write fresh data back to cache
    if (cache && cacheKey) {
      await cacheSet(cacheKey, res.data);
    }
  }

  return res.data;
}

/**
 * Invalidate cache keys. Works across both storage backends.
 */
export async function invalidateCache(...keys) {
  await cacheDel(...keys);
}

// Re-export for backward compatibility
export { isCached };

// --- Cache Key Constants ---
export const CACHE_KEYS = {
  JOBS: 'aiper_jobs',
  JOBS_HEAD_ACTIVE: 'aiper_jobs_head_active',
  JOBS_ALL: 'aiper_jobs_all',
  JOBS_AUDIT_HEAD: 'aiper_jobs_audit_head',
  USERS: 'aiper_users',
  INSTANCES: 'aiper_instances',
  STATS: 'aiper_stats',
  MY_TASKS: 'aiper_my_tasks',
  TRANSFERS_IN: 'aiper_transfers_in',
  TRANSFERS_OUT: 'aiper_transfers_out',
  GROUPS: 'aiper_groups',
  GLOBAL_PARAMS: 'aiper_global_params',
  JOBS_HEAD_ALL: 'aiper_jobs_head_all',           // full active head jobs, fetched once on first search activation in Dispatcher
  INSTANCES_HEAD_ALL: 'aiper_instances_head_all', // full PENDING_HEAD_REVIEW instances, fetched once on first search activation in Review Queue
};
