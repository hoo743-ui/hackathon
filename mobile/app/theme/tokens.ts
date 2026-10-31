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

const lightMaterial: Record<WasteType, string> = { plastic: '#2E6F95', metal: '#6D4FA0', paper: '#8C6A2F', glass: '#3F4449' };
const darkMaterial: Record<WasteType, string> = { plastic: '#6FA8D1', metal: '#A98BD3', paper: '#C9A465', glass: '#9AA1A8' };

export const colors: Record<Scheme, ColorTokens> = {
  light: {
    bg: '#F3F1EC',
    surface: '#FBFAF7',
    surfaceSunken: '#E9E6DF',
    ink: '#16181B',
    ink2: '#4A4F55',
    ink3: '#6B7076',
    rule: '#D6D2C8',
    ruleStrong: '#16181B',
    accent: '#3D5A66',
    ok: '#1F6B4A',
    attention: '#8A5A00',
    warning: '#C2410C',
    critical: '#B3261E',
    unknown: '#8D9196',
    signal: '#D9480F',
    onSignal: '#FFFFFF',
    onCritical: '#FFFFFF',
    scrim: 'rgba(22,24,27,0.45)',
    material: lightMaterial,
    fill: { normal: '#1F6B4A', attention: '#8A5A00', warning: '#C2410C', critical: '#B3261E', unknown: '#8D9196' },
  },
  dark: {
    bg: '#111315',
    surface: '#181B1E',
    surfaceSunken: '#0C0E10',
    ink: '#ECEAE4',
    ink2: '#A9ADB2',
    ink3: '#8A8F95',
    rule: '#2A2E33',
    ruleStrong: '#ECEAE4',
    accent: '#8FB3C2',
    ok: '#4FB286',
    attention: '#E0A33A',
    warning: '#FF7A3D',
    critical: '#F2665C',
    unknown: '#6B7076',
    signal: '#FF7A3D',
    onSignal: '#111315',
    // 다크의 critical(#F2665C)은 밝으므로 흑연 글자가 AA 대비를 만족한다
    onCritical: '#111315',
    scrim: 'rgba(0,0,0,0.6)',
    material: darkMaterial,
    fill: { normal: '#4FB286', attention: '#E0A33A', warning: '#FF7A3D', critical: '#F2665C', unknown: '#6B7076' },
  },
};

/** 간격 4 기반 (--s1…--s8) */
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48, s8: 64 } as const;
/** 반경: 괘선 0, 칩 2, 패널 4, 긴급정지 6. 카드 전체를 둥글게 만들지 않는다. */
export const radius = { none: 0, chip: 2, panel: 4, estop: 6 } as const;
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
