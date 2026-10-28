/** 발급번호 + QR(진위검증). QR 이미지는 BE 발급 시 qrDataUrl 주입(없으면 URL 텍스트+슬롯). */
export function IssueStamp({ issueNo, qrUrl, qrDataUrl }: {
  issueNo?: string; qrUrl?: string; qrDataUrl?: string;
}) {
  return (
    <div className="doc-issue" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '7.5pt', color: '#444' }}>
      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrDataUrl} alt="진위검증 QR" style={{ width: 48, height: 48 }} />
      ) : (
        <span style={{ width: 48, height: 48, border: '1px solid #bbb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '6pt', color: '#999', textAlign: 'center' }}>QR</span>
      )}
      <div>
        <div>발급번호 {issueNo ?? '(미발급)'}</div>
        {qrUrl ? <div style={{ color: '#888' }}>{qrUrl}</div> : null}
      </div>
    </div>
  );
}
