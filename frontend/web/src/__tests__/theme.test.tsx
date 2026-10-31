import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestSource } from './helpers';
import { renderApp } from './renderApp';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: '앱 설정' }));
  return screen.getByRole('dialog', { name: '앱 설정' });
}

describe('헤더 앱 설정 메뉴', () => {
  it('테마를 고르면 data-theme 과 저장소가 바뀐다', async () => {
    renderApp(makeTestSource(), '/');
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole('button', { name: '다크' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('smartbin.theme')).toBe('dark');
    fireEvent.click(within(menu).getByRole('button', { name: '라이트' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(within(menu).getByRole('button', { name: '시스템' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('smartbin.theme')).toBeNull();
  });

  it('Esc 로 닫히고 제어 토큰을 저장한다', async () => {
    renderApp(makeTestSource(), '/');
    const menu = await openMenu();
    fireEvent.change(within(menu).getByLabelText('제어 토큰'), { target: { value: 'abc' } });
    expect(window.localStorage.getItem('smartbin.controlToken')).toBe('abc');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '앱 설정' })).not.toBeInTheDocument();
  });

  it('localStorage 접근이 실패해도 테마는 적용된다', async () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      renderApp(makeTestSource(), '/');
      const menu = await openMenu();
      fireEvent.click(within(menu).getByRole('button', { name: '다크' }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      Object.defineProperty(window, 'localStorage', orig);
    }
  });
});
