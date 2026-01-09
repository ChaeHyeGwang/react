import axiosInstance from './axios';

let cache = {
  data: null,
  fetchedAt: 0,
  inflight: null,
};

const TTL_MS = 60 * 1000; // 60초 캐시

export async function getIdentitiesCached() {
  const now = Date.now();
  // 유효 캐시 반환
  if (cache.data && now - cache.fetchedAt < TTL_MS) {
    return cache.data;
  }
  // 진행 중 요청 재사용
  if (cache.inflight) {
    return cache.inflight;
  }
  cache.inflight = axiosInstance.get('/identities')
    .then((res) => {
      const identities = res.data?.identities || [];
      cache.data = identities;
      cache.fetchedAt = Date.now();
      cache.inflight = null;
      return identities;
    })
    .catch((err) => {
      cache.inflight = null;
      throw err;
    });
  return cache.inflight;
}

export function invalidateIdentitiesCache() {
  cache.data = null;
  cache.fetchedAt = 0;
}
