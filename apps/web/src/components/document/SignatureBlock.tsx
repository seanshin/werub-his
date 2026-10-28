/** 서명/직인란 — 의료진 서명 이미지 + 병원 직인. 순수 컴포넌트. */
export function SignatureBlock({ signer, stampUrl, label = '의사' }: {
  signer?: { name?: string; license?: string; signatureImageUrl?: string };
  stampUrl?: string; label?: string;
}) {
  return (
    <div className="doc-sign" style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 24, alignItems: 'flex-end' }}>
      <div style={{ textAlign: 'right', fontSize: '9.5pt' }}>
        <div>{label} {signer?.name ?? ''} {signer?.license ? `(면허 ${signer.license})` : ''}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, minHeight: 40 }}>
          {signer?.signatureImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signer.signatureImageUrl} alt="서명" style={{ height: 36 }} />
          ) : <span style={{ color: '#999' }}>(서명)</span>}
          {stampUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="doc-stamp" src={stampUrl} alt="직인" style={{ height: 44, width: 44 }} />
          ) : <span style={{ border: '1px dashed #c00', color: '#c00', borderRadius: '50%', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '7pt' }}>직인</span>}
        </div>
      </div>
    </div>
  );
}
