import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeTestSource } from './helpers';
import { renderApp } from './renderApp';

describe('메뉴와 이전 경로', () => {
  it.each([
    ['/control', '/operations'],
    ['/history', '/sorting'],
    ['/analytics', '/bins'],
    ['/settings', '/devices'],
  ])('%s → %s 로 이동한다', async (from, to) => {
    renderApp(makeTestSource(), from);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${to}$`)));
  });

  it('주 메뉴는 5개다', async () => {
    renderApp(makeTestSource(), '/');
    const nav = (await screen.findAllByRole('navigation', { name: '주 메뉴' }))[0];
    const labels = [...nav.querySelectorAll('a')].map((a) => a.textContent);
    expect(labels).toEqual(['개요', '수거함', '분류 기록', '장치', '운영']);
  });
});
