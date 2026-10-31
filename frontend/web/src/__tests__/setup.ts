import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => cleanup());

// recharts ResponsiveContainer 가 사용하는 ResizeObserver 는 jsdom 에 없다.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom 에는 레이아웃이 없어 ResponsiveContainer 가 0x0 경고를 낸다 → 고정 크기로 대체
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  const { cloneElement, createElement } = await import('react');
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      createElement('div', { style: { width: 800, height: 260 } }, cloneElement(children, { width: 800, height: 260 } as object)),
  };
});

// jsdom 은 스크롤을 구현하지 않는다 (경로 이동 시 ScrollManager 가 호출)
window.scrollTo = (() => {}) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

// Node 22+ 의 실험적 전역 localStorage 가 jsdom 의 것을 가려 undefined 가 되는 환경이 있다 → 메모리 저장소로 대체
if (typeof window.localStorage === 'undefined' || window.localStorage === null) {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}
