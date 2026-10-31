import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FillReadout, MaterialColumn } from '../components/material';

describe('MaterialColumn', () => {
  it('null 은 0% 가 아니라 미확인(해치)으로 그린다', () => {
    const { container } = render(<MaterialColumn type="paper" percent={null} calibrated={false} />);
    const meter = screen.getByRole('meter');
    expect(meter).not.toHaveAttribute('aria-valuenow');
    expect(meter).toHaveAttribute('aria-valuetext', '미보정 (값 없음)');
    expect(meter).toHaveAttribute('data-level', 'unknown');
    expect(container.querySelector('.mcol__fill--unknown')).not.toBeNull();
    expect(meter.getAttribute('aria-valuetext')).not.toMatch(/0%/);
  });

  it('보정됐지만 측정값이 없으면 "측정값 없음"', () => {
    render(<MaterialColumn type="metal" percent={null} calibrated />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '측정값 없음 (값 없음)');
  });

  it('0% 는 실제 0 으로 그리고 값을 알린다', () => {
    const { container } = render(<MaterialColumn type="metal" percent={0} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect((container.querySelector('.mcol__fill') as HTMLElement).style.height).toBe('0%');
    expect(container.querySelector('.mcol__fill--unknown')).toBeNull();
  });

  it('값과 단계를 접근 가능한 라벨로 노출하고 50/80/95 눈금을 그린다', () => {
    const { container } = render(<MaterialColumn type="plastic" percent={86.4} />);
    const meter = screen.getByRole('meter', { name: '플라스틱 적재율' });
    expect(meter).toHaveAttribute('aria-valuetext', '86.4%, 경고');
    expect(meter).toHaveAttribute('data-level', 'warning');
    expect([...container.querySelectorAll('.mcol__tick')].map((t) => t.getAttribute('data-t'))).toEqual(['50', '80', '95']);
  });

  it('판독값도 null 을 "--" 로 표시한다', () => {
    render(<FillReadout percent={null} calibrated={false} />);
    expect(screen.getByTestId('fill-readout')).toHaveTextContent('--');
    expect(screen.getByTestId('fill-readout')).toHaveAttribute('aria-label', '적재율 정보 없음 (미보정)');
  });
});
