import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 폰트는 로컬 번들 (CDN 없음, LAN 오프라인 동작)
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/charts.css';
import './styles/pages/overview.css';
import './styles/pages/bins.css';
import './styles/pages/devices.css';
import './styles/pages/operations.css';
import './styles/pages/sorting.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
