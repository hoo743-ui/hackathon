import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** 섹션: 카드 테두리 대신 상단 2px 잉크 괘선 + 제목 (Ledger rule) */
export function Section({
  title,
  aside,
  children,
  className = '',
  id,
  rule = 'strong',
  testId,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  rule?: 'strong' | 'light';
  testId?: string;
}) {
  const auto = useId();
  const headingId = `${id ?? auto}-title`;
  return (
    <section className={`section section--${rule} ${className}`} aria-labelledby={headingId} id={id} data-testid={testId}>
      <header className="section__head">
        <h2 className="section__title" id={headingId}>
          {title}
        </h2>
        {aside && <div className="section__aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

export function PageHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__main">
        <h1 className="t-display">{title}</h1>
        {children}
      </div>
      {meta && <div className="page-head__meta">{meta}</div>}
    </div>
  );
}

/** 정의 목록 (dt/dd) — 1px 괘선 행 */
export function DataList({ items, className = '' }: { items: { term: ReactNode; value: ReactNode; note?: ReactNode; key?: string }[]; className?: string }) {
  return (
    <dl className={`dlist ${className}`}>
      {items.map((it, i) => (
        <div className="dlist__row" key={it.key ?? i}>
          <dt>{it.term}</dt>
          <dd>
            {it.value}
            {it.note && <span className="dlist__note">{it.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ButtonVariant = 'primary' | 'signal' | 'danger' | 'quiet' | 'default';
export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  return <button type="button" className={`btn btn--${variant} btn--${size} ${className}`} {...rest} />;
}

/** 세그먼트 컨트롤 (단일 선택) */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  size = 'md',
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className={`seg seg--${size}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled || o.disabled}
          onClick={() => value !== o.value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = 'ok' | 'attention' | 'warning' | 'critical' | 'unknown' | 'accent' | 'neutral';

/** 상태 점 — 항상 텍스트와 함께 쓴다 (색만으로 전달 금지) */
export function StatusDot({ tone }: { tone: Tone }) {
  return <span className="dot" data-tone={tone} aria-hidden />;
}

export function StatusText({ tone, children, strong }: { tone: Tone; children: ReactNode; strong?: boolean }) {
  return (
    <span className={`status-text ${strong ? 'status-text--strong' : ''}`} data-tone={tone}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone | 'sim'; title?: string }) {
  return (
    <span className="tag" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/** 시뮬레이터/Mock 데이터 표시 (대문자 변환 금지, 오렌지 점선 테두리) */
export function DataSourceTag({ mock }: { mock?: boolean }) {
  const text = mock ? 'Mock 데이터' : '시뮬레이터 데이터';
  return (
    <span className="tag tag--sim" data-testid="sim-tag" title="실제 센서 측정값이 아닙니다" aria-label={`${text}: 실제 센서 측정값이 아닙니다`}>
      {text}
    </span>
  );
}

export function EmptyState({ children, title }: { children?: ReactNode; title?: ReactNode }) {
  return (
    <div className="state state--empty">
      {title && <p className="state__title">{title}</p>}
      {children && <p className="state__body">{children}</p>}
    </div>
  );
}

export function LoadingState({ children = '불러오는 중…' }: { children?: ReactNode }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <p className="state__body">{children}</p>
    </div>
  );
}

export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__body">{children}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}

/** 페이지 안 공지 줄 (좌측 3px 신호색 막대) */
export function Notice({ tone = 'neutral', children, role, testId }: { tone?: Tone; children: ReactNode; role?: 'alert' | 'status'; testId?: string }) {
  return (
    <div className="notice" data-tone={tone} role={role} data-testid={testId}>
      {children}
    </div>
  );
}
