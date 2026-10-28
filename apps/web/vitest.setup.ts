import '@testing-library/jest-dom/vitest';

// api-client 가 모듈 로드 시점에 localStorage 를 읽는다(토큰 복원). jsdom 이 제공하지 않는 환경에서도
// 컴포넌트 테스트가 임포트 단계에서 죽지 않도록 최소 스텁을 깔아 둔다.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
  });
}
