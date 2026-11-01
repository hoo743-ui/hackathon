import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DashboardProvider } from '../services/DashboardContext';
import { AppThemeProvider } from '../theme/ThemeContext';
import { FONT_FAMILIES } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** 폰트 로드를 기다리는 최대 시간. 넘으면 시스템 폰트로 먼저 그리고, 로드되면 교체한다. */
const FONT_WAIT_MS = 1200;

export default function RootLayout() {
  // 앱에 번들된 폰트 파일만 사용 (런타임 네트워크 없음). 실제로 쓰는 굵기만 로드.
  const [loaded, error] = useFonts({
    // Pretendard (SIL OFL) — 웹과 같은 글꼴. 앱에 포함되어 오프라인에서도 동일
    [FONT_FAMILIES.sans400]: require('../assets/fonts/Pretendard-Regular.otf'),
    [FONT_FAMILIES.sans500]: require('../assets/fonts/Pretendard-Medium.otf'),
    [FONT_FAMILIES.sans600]: require('../assets/fonts/Pretendard-SemiBold.otf'),
    [FONT_FAMILIES.sans700]: require('../assets/fonts/Pretendard-Bold.otf'),
  });
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), FONT_WAIT_MS);
    return () => clearTimeout(id);
  }, []);
  const ready = loaded || !!error || waited;

  return (
    <SafeAreaProvider>
      <AppThemeProvider fontsLoaded={loaded && !error}>
        {ready ? <AppShell /> : <Blank />}
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

function Blank() {
  const { c } = useTheme();
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}

function AppShell() {
  const { scheme, c, t } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: c.bg, card: c.bg, text: c.ink, border: c.rule, primary: c.accent },
  };
  return (
    <ThemeProvider value={navTheme}>
      <DashboardProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.ink,
            headerTitleStyle: { ...t.bodyStrong, color: c.ink },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: c.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="bin/[id]" options={{ title: '수거함', headerBackTitle: '뒤로' }} />
          <Stack.Screen name="settings" options={{ title: '설정', headerBackTitle: '홈' }} />
        </Stack>
      </DashboardProvider>
    </ThemeProvider>
  );
}
