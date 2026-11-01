import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 폰트는 로컬 번들 (CDN 없음, LAN 오프라인 동작)
// Pretendard — 국내 상용 앱·웹 표준 한글 글꼴 (SIL OFL). 파일을 번들에 포함해 오프라인(현장 LAN)에서도 동일하게 표시
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
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
import './styles/brand.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
