import { DocHeader } from '../DocHeader';
import { DocFooter } from '../DocFooter';
import { SignatureBlock } from '../SignatureBlock';
import { IssueStamp } from '../IssueStamp';
import { useHospitalProfile } from '../lib/hospitalProfile';
import type { DocumentMeta } from '../lib/documentMeta';
import { safeFormat } from '@/lib/safe-date';

export interface BirthCertificateData {
  patient: { name?: string; rrn?: string; mrn?: string; sex?: string; birth?: string; address?: string }; // 산모
  birth?: {
    birthAt?: string;
    sex?: string; // M/F/AMBIGUOUS
    weightG?: number | null;
    lengthCm?: number | null;
    deliveryType?: string | null; // VAGINAL/VACUUM/FORCEPS/CESAREAN
    gestationalWeeks?: string | null; // "39+2" 원문(변조 금지)
    birthOrder?: number;
    totalNewborns?: number;
  };
  purpose?: string;
  doctor?: { name?: string; license?: string };
  issuedAt?: string;
}

const SEX_LABEL: Record<string, string> = { M: '남', F: '여', AMBIGUOUS: '미상(성 구분 곤란)' };
const DELIVERY_LABEL: Record<string, string> = { VAGINAL: '자연분만', VACUUM: '흡입분만', FORCEPS: '겸자분만', CESAREAN: '제왕절개' };

/**
 * 출생증명서 — 의료법 시행규칙 서식 준거. 원천 정본은 DeliveryRecord/NewbornRecord(분만·신생아 기록).
 * 🔴 부(父) 정보·신생아 성명은 원천 데이터가 없어 공란("모의 성명으로 갈음")으로 둔다 — 지어내지 않는다.
 * 서식 문안·항목 최종 확정은 법무/원무 확인 대상(N-W1 §5).
 */
export function BirthCertificateDoc({ data, meta }: { data: BirthCertificateData; meta?: DocumentMeta }) {
  const hospital = useHospitalProfile();
  const b = data.birth ?? {};

  return (
    <section className="doc-page">
      <DocHeader hospital={hospital} title="출생증명서" />

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th colSpan={4} style={{ background: '#f3f4f6', textAlign: 'left' }}>출생아</th>
          </tr>
          <tr className="doc-row">
            <th style={{ width: '16%', background: '#fafafa' }}>성명</th>
            <td style={{ width: '34%' }}>(미정 — 모의 성명으로 갈음)</td>
            <th style={{ width: '16%', background: '#fafafa' }}>성별</th>
            <td>{b.sex ? (SEX_LABEL[b.sex] ?? b.sex) : '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa' }}>출생 일시</th>
            <td>{b.birthAt ? safeFormat(b.birthAt, 'yyyy-MM-dd HH:mm') : '-'}</td>
            <th style={{ background: '#fafafa' }}>출생 순위</th>
            <td>{b.birthOrder ?? '-'}{b.totalNewborns && b.totalNewborns > 1 ? ` (다태아 ${b.totalNewborns}명 중)` : ''}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa' }}>체중</th>
            <td>{b.weightG != null ? `${b.weightG.toLocaleString('ko-KR')} g` : '-'}</td>{/* 원문 그램 그대로 — 재반올림 금지 */}
            <th style={{ background: '#fafafa' }}>신장</th>
            <td>{b.lengthCm != null ? `${b.lengthCm} cm` : '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa' }}>임신 주수</th>
            <td>{b.gestationalWeeks ?? '-'}</td>
            <th style={{ background: '#fafafa' }}>분만 방법</th>
            <td>{b.deliveryType ? (DELIVERY_LABEL[b.deliveryType] ?? b.deliveryType) : '-'}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr className="doc-row">
            <th colSpan={4} style={{ background: '#f3f4f6', textAlign: 'left' }}>모(母)</th>
          </tr>
          <tr className="doc-row">
            <th style={{ width: '16%', background: '#fafafa' }}>성명</th>
            <td style={{ width: '34%' }}>{data.patient.name ?? '-'}</td>
            <th style={{ width: '16%', background: '#fafafa' }}>주민등록번호</th>
            <td>{data.patient.rrn ?? '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#fafafa' }}>생년월일</th>
            <td>{data.patient.birth ? safeFormat(data.patient.birth, 'yyyy-MM-dd') : '-'}</td>
            <th style={{ background: '#fafafa' }}>등록번호</th>
            <td>{data.patient.mrn ?? '-'}</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>부(父)</th>
            <td colSpan={3} style={{ color: '#888' }}>(기록 없음 — 신고 시 기재)</td>
          </tr>
          <tr className="doc-row">
            <th style={{ background: '#f3f4f6', textAlign: 'left' }}>용도</th>
            <td colSpan={3}>{data.purpose || '-'}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: '9pt', marginTop: 8 }}>위 아이는 위 산모로부터 본 의료기관에서 출생하였음을 증명합니다.</p>
      <p style={{ textAlign: 'center', fontSize: '10pt', margin: '10px 0' }}>{data.issuedAt ? safeFormat(data.issuedAt, 'yyyy-MM-dd') : meta?.issuedAt ? safeFormat(meta.issuedAt, 'yyyy-MM-dd') : '-'}</p>

      <SignatureBlock label="분만 의사" signer={{ name: data.doctor?.name, license: data.doctor?.license }} stampUrl={hospital.stampUrl} />
      <p style={{ fontSize: '8pt', color: '#666', marginTop: 4 }}>※ 의료법 시행규칙 서식 준거. 출생 정보는 분만·신생아 기록 원문에 근거함.</p>
      <div style={{ marginTop: 10 }}><IssueStamp issueNo={meta?.issueNo} qrUrl={meta?.qrUrl} qrDataUrl={meta?.qrDataUrl} /></div>
      <DocFooter pageNo={1} totalN={1} issuedAt={meta?.issuedAt ?? data.issuedAt} issuedBy={data.doctor?.name} />
    </section>
  );
}
