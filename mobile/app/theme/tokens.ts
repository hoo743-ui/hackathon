// 디자인 토큰 — "Material Ledger" (docs/design/REDESIGN_PLAN.md §2). 웹(frontend)과 같은 값·이름.
// 종이 바탕 + 잉크 위계, 상태 신호색은 위험에만. 그라데이션·그림자·대문자 변환 없음.
import { Platform, type TextStyle } from 'react-native';
import type { FillLevel, WasteType } from '../services/shared';

export type Scheme = 'light' | 'dark';

export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceSunken: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  ruleStrong: string;
  /** 미네랄 — 링크·선택·포커스 (상태 아님) */
  accent: string;
  ok: string;
  attention: string;
  warning: string;
  critical: string;
  unknown: string;
  /** 주요 실행 버튼(배출구 작동) 전용 */
  signal: string;
  /** signal / critical 위의 글자색 */
  onSignal: string;
  onCritical: string;
  /** 오버레이 뒤 딤 */
  scrim: string;
  /** 재질 정체성 색 (상태 표시에 쓰지 않음) */
  material: Record<WasteType, string>;
  /** 적재 단계색 (컬럼 채움) */
  fill: Record<FillLevel, string>;
}

// 재질색 — 웹(tokens.css)과 동일. 상태 표시에 쓰지 않음
const lightMaterial: Record<WasteType, string> = { plastic: '#2D77CD', metal: '#845CB5', paper: '#BE893A', glass: '#738289' };
const darkMaterial: Record<WasteType, string> = { plastic: '#6AA6E8', metal: '#B094D6', paper: '#D9AE6A', glass: '#A3B0B5' };

export const colors: Record<Scheme, ColorTokens> = {
  light: {
    // SMART RECYCLE 브랜드 — 진녹 #0D4335 · 그린 #1B7957 · 틸 #41848B · 민트 #DCF0E5 (웹과 동일)
    bg: '#F6F9F6',
    surface: '#FFFFFF',
    surfaceSunken: '#EEF4EF',
    ink: '#1C2F2B',
    ink2: '#3F564F',
    ink3: '#637770',
    rule: '#D3E1D8',
    ruleStrong: '#0D4335',
    accent: '#41848B',
    ok: '#1B7957',
    attention: '#8A5A00',
    warning: '#C2410C',
    critical: '#B3261E',
    unknown: '#8D9A95',
    signal: '#0D4335',
    onSignal: '#FFFFFF',
    onCritical: '#FFFFFF',
    scrim: 'rgba(13,67,53,0.45)',
    material: lightMaterial,
    fill: { normal: '#1B7957', attention: '#8A5A00', warning: '#C2410C', critical: '#B3261E', unknown: '#8D9A95' },
  },
  dark: {
    bg: '#0B1613',
    surface: '#11201C',
    surfaceSunken: '#08110F',
    ink: '#E6EFEA',
    ink2: '#AABDB5',
    ink3: '#82978F',
    rule: '#23362F',
    ruleStrong: '#DCF0E5',
    accent: '#6FB3B9',
    ok: '#4FBF8B',
    attention: '#E0A33A',
    warning: '#FF7A3D',
    critical: '#F2665C',
    unknown: '#6F817B',
    signal: '#4FBF8B',
    onSignal: '#0B1613',
    // 다크의 critical(#F2665C)은 밝으므로 어두운 글자가 AA 대비를 만족한다
    onCritical: '#0B1613',
    scrim: 'rgba(0,0,0,0.6)',
    material: darkMaterial,
    fill: { normal: '#4FBF8B', attention: '#E0A33A', warning: '#FF7A3D', critical: '#F2665C', unknown: '#6F817B' },
  },
};

/** 간격 4 기반 (--s1…--s8) */
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48, s8: 64 } as const;
/** 반경: 카드 14 · 패널 12 · 버튼 8 · 칩 6 (웹 --r-card/--r-panel/--r-btn/--r-chip 과 동일) */
export const radius = { none: 0, chip: 6, btn: 8, panel: 12, card: 14, estop: 10 } as const;
/** 최소 터치 영역 (pt) */
export const touchTarget = 44;
/** 섹션 괘선 두께 */
export const ruleWidth = { section: 2, row: 1 } as const;
/** 모션 (ms) — 상태 변화에만 */
export const motion = { fill: 240, status: 150, step: 150, hold: 600 } as const;

/** 번들 폰트 패밀리 이름 (expo-font 로 등록되는 키와 동일) */
export const FONT_FAMILIES = {
  sans400: 'IBMPlexSansKR_400Regular',
  sans500: 'IBMPlexSansKR_500Medium',
  sans600: 'IBMPlexSansKR_600SemiBold',
  mono400: 'IBMPlexMono_400Regular',
  mono500: 'IBMPlexMono_500Medium',
} as const;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };
const systemMono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

type Weight = 400 | 500 | 600;
/**
 * 폰트 지정. 번들 폰트가 로드되면 굵기별 패밀리를 쓰고 fontWeight 는 지정하지 않는다
 * (웹에서 단일 굵기 face 에 fontWeight 를 주면 가짜 굵게가 합성됨). 로드 실패/지연 시 시스템 폰트 + fontWeight.
 */
function face(loaded: boolean, weight: Weight, mono = false): TextStyle {
  if (mono) {
    if (loaded) return { fontFamily: weight >= 500 ? FONT_FAMILIES.mono500 : FONT_FAMILIES.mono400 };
    return { fontFamily: systemMono, fontWeight: weight >= 500 ? '500' : '400' };
  }
  if (loaded) return { fontFamily: weight === 600 ? FONT_FAMILIES.sans600 : weight === 500 ? FONT_FAMILIES.sans500 : FONT_FAMILIES.sans400 };
  return { fontWeight: String(weight) as TextStyle['fontWeight'] };
}

/** 타입 스케일 (§2.4, 모바일 값). 대문자 변환 금지. 숫자는 tabular. */
export function makeTypography(fontsLoaded: boolean) {
  const f = (w: Weight, mono = false) => face(fontsLoaded, w, mono);
  return {
    display: { fontSize: 32, lineHeight: 36, letterSpacing: -0.6, ...f(600) },
    readoutXl: { fontSize: 48, lineHeight: 52, letterSpacing: -1, ...f(500), ...tabular },
    readout: { fontSize: 28, lineHeight: 32, letterSpacing: -0.4, ...f(500), ...tabular },
    title: { fontSize: 22, lineHeight: 28, ...f(600) },
    /** 섹션 머리 (ledger rule 아래) */
    section: { fontSize: 17, lineHeight: 24, ...f(600) },
    body: { fontSize: 15, lineHeight: 22, ...f(400) },
    bodyStrong: { fontSize: 15, lineHeight: 22, ...f(500) },
    label: { fontSize: 13, lineHeight: 18, ...f(500) },
    caption: { fontSize: 12, lineHeight: 16, ...f(400) },
    mono: { fontSize: 13, lineHeight: 18, ...f(400, true), ...tabular },
    monoStrong: { fontSize: 13, lineHeight: 18, ...f(500, true), ...tabular },
    /** 판독값 단위 (%·cm) */
    unit: { fontSize: 15, lineHeight: 20, ...f(500) },
    tabular,
  } satisfies Record<string, TextStyle>;
}

export type Typography = ReturnType<typeof makeTypography>;
