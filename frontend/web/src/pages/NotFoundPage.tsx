import { Link } from 'react-router-dom';
import { PageHeader } from '../components/primitives';

export function NotFoundPage() {
  return (
    <div className="page">
      <PageHeader title="페이지를 찾을 수 없습니다" />
      <p>
        <Link to="/">개요로 돌아가기</Link>
      </p>
    </div>
  );
}
