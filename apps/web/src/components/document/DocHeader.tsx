import type { HospitalProfile } from './lib/hospitalProfile';

/** 문서 머리글 — 병원 법정정보(요양기관기호 등) + 로고 + 문서 제목. 순수 컴포넌트. */
export function DocHeader({ hospital, title }: { hospital: HospitalProfile; title: string }) {
  return (
    <header className="doc-header" style={{ borderBottom: '2px solid #111', paddingBottom: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {hospital.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hospital.logoUrl} alt={`${hospital.name} 로고`} style={{ height: 36 }} />
          ) : null}
          <div>
            <div style={{ fontSize: '13pt', fontWeight: 700 }}>{hospital.name}</div>
            <div style={{ fontSize: '8pt', color: '#444' }}>
              요양기관기호 {hospital.ykiho} · {hospital.address} · TEL {hospital.tel}
            </div>
          </div>
        </div>
        <h1 style={{ fontSize: '16pt', fontWeight: 800, letterSpacing: 4 }}>{title}</h1>
      </div>
    </header>
  );
}
