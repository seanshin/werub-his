import { safeFormat } from '@/lib/safe-date';

/** 문서 꼬리글 — 발급정보 + 페이지 번호. 순수 컴포넌트. */
export function DocFooter({ pageNo, totalN, issuedAt, issuedBy }: {
  pageNo: number; totalN: number; issuedAt?: string; issuedBy?: string;
}) {
  return (
    <footer className="doc-footer" style={{ borderTop: '1px solid #999', marginTop: 12, paddingTop: 6, fontSize: '8pt', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
      <span>발급일시 {issuedAt ? safeFormat(issuedAt, 'yyyy-MM-dd HH:mm') : '-'}{issuedBy ? ` · 발급자 ${issuedBy}` : ''}</span>
      <span>{pageNo} / {totalN}</span>
    </footer>
  );
}
