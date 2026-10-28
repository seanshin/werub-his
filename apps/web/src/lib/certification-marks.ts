// ════════════════════════════════════════════════════════════════
//  인증마크 레지스트리 — 화면/기능별 의료 인증 표준 매핑
//  (EMR 인증 · JCI · 의료기관평가인증원 · 의료법 · 개인정보보호)
//  화면 우하단 CertificationBadge가 현재 경로에 해당하는 마크를 표시
// ════════════════════════════════════════════════════════════════

export type CertCategory = 'EMR' | 'JCI' | 'ACI' | 'LAW' | 'PRIVACY';

export interface CertMark {
  code: string;        // 고유 코드 (JCI:IPSG.1 등)
  label: string;       // 배지 표시 라벨
  category: CertCategory;
  desc: string;        // 인증 근거 설명
}

export const CERT_CATEGORY_META: Record<CertCategory, { label: string; cls: string; dot: string }> = {
  EMR:     { label: 'EMR 인증',         cls: 'bg-blue-50 text-blue-700 border-blue-200',     dot: 'bg-blue-500' },
  JCI:     { label: 'JCI',              cls: 'bg-amber-50 text-amber-700 border-amber-200',   dot: 'bg-amber-500' },
  ACI:     { label: '인증평가',          cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  LAW:     { label: '의료법',           cls: 'bg-gray-100 text-gray-700 border-gray-200',     dot: 'bg-gray-500' },
  PRIVACY: { label: '개인정보보호',      cls: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
};

// 표준 마크 카탈로그
const M = {
  // EMR 인증 (보건복지부 전자의무기록시스템 인증)
  EMR_RECORD:   { code: 'EMR:RECORD', label: 'EMR 의무기록', category: 'EMR', desc: 'EMR 인증 — 의무기록 작성·서명·완결' } as CertMark,
  EMR_ACCESS:   { code: 'EMR:ACCESS', label: 'EMR 접근통제', category: 'EMR', desc: 'EMR 인증 — RBAC·접근감사·Break-the-Glass' } as CertMark,
  EMR_SIGN:     { code: 'EMR:SIGN',   label: 'EMR 전자서명', category: 'EMR', desc: 'EMR 인증 — 블록체인 전자서명' } as CertMark,
  EMR_CPOE:     { code: 'EMR:CPOE',   label: 'EMR 처방전달', category: 'EMR', desc: 'EMR 인증 — CPOE/OCS 처방전달' } as CertMark,
  // JCI 환자안전목표
  IPSG1: { code: 'JCI:IPSG.1', label: 'IPSG.1 환자확인', category: 'JCI', desc: 'JCI IPSG.1 — 정확한 환자 확인(두 식별자/바코드)' } as CertMark,
  IPSG2: { code: 'JCI:IPSG.2', label: 'IPSG.2 의사소통', category: 'JCI', desc: 'JCI IPSG.2 — Read-back·위급값·SBAR/I-PASS·NEWS2' } as CertMark,
  IPSG3: { code: 'JCI:IPSG.3', label: 'IPSG.3 고위험약물', category: 'JCI', desc: 'JCI IPSG.3 — 고위험/마약류 약물 관리' } as CertMark,
  IPSG4: { code: 'JCI:IPSG.4', label: 'IPSG.4 수술안전', category: 'JCI', desc: 'JCI IPSG.4 — 수술 타임아웃·체크리스트·부위표시' } as CertMark,
  IPSG5: { code: 'JCI:IPSG.5', label: 'IPSG.5 감염예방', category: 'JCI', desc: 'JCI IPSG.5 — 감염 감시·격리·손위생' } as CertMark,
  IPSG6: { code: 'JCI:IPSG.6', label: 'IPSG.6 낙상예방', category: 'JCI', desc: 'JCI IPSG.6 — 낙상위험평가(Morse)' } as CertMark,
  // JCI 챕터
  ACC: { code: 'JCI:ACC', label: 'ACC 진료연속성', category: 'JCI', desc: 'JCI ACC — 입퇴원·전원·응급·진료의뢰' } as CertMark,
  PFR: { code: 'JCI:PFR', label: 'PFR 환자권리', category: 'JCI', desc: 'JCI PFR — 환자권리·동의·고충처리' } as CertMark,
  AOP: { code: 'JCI:AOP', label: 'AOP 환자평가', category: 'JCI', desc: 'JCI AOP — 초기·간호·영양·통증 평가' } as CertMark,
  COP: { code: 'JCI:COP', label: 'COP 진료', category: 'JCI', desc: 'JCI COP — 진료기록·고위험환자·임종' } as CertMark,
  ASC: { code: 'JCI:ASC', label: 'ASC 마취수술', category: 'JCI', desc: 'JCI ASC — 마취·수술·회복실 기록' } as CertMark,
  MMU: { code: 'JCI:MMU', label: 'MMU 약물관리', category: 'JCI', desc: 'JCI MMU — 처방·조제·투약·DUR' } as CertMark,
  PCI: { code: 'JCI:PCI', label: 'PCI 감염관리', category: 'JCI', desc: 'JCI PCI — 감염 감시·격리·멸균' } as CertMark,
  QPS: { code: 'JCI:QPS', label: 'QPS 질·안전', category: 'JCI', desc: 'JCI QPS — 질 지표·안전사고·RCA' } as CertMark,
  MOI: { code: 'JCI:MOI', label: 'MOI 정보관리', category: 'JCI', desc: 'JCI MOI — 의무기록·통계·표준용어' } as CertMark,
  SQE: { code: 'JCI:SQE', label: 'SQE 직원자격', category: 'JCI', desc: 'JCI SQE — 면허·자격증·필수교육 추적' } as CertMark,
  GLD: { code: 'JCI:GLD', label: 'GLD 거버넌스', category: 'JCI', desc: 'JCI GLD — 위원회·회의록·기관 정책 관리' } as CertMark,
  PCI5: { code: 'JCI:PCI', label: 'PCI 감염관리', category: 'JCI', desc: 'JCI PCI/IPSG.5 — 손위생 모니터링' } as CertMark,
  // 의료기관평가인증원 (ACI)
  ACI: { code: 'ACI', label: '의료기관 인증', category: 'ACI', desc: '의료기관평가인증원 인증기준' } as CertMark,
  // 의료법
  LAW21: { code: 'LAW:21',   label: '의료법 §21', category: 'LAW', desc: '의료법 제21조 — 기록 열람·사본 발급' } as CertMark,
  LAW22: { code: 'LAW:22',   label: '의료법 §22', category: 'LAW', desc: '의료법 제22조 — 진료기록부 작성·보존(10년)' } as CertMark,
  LAW24: { code: 'LAW:24-2', label: '의료법 §24-2', category: 'LAW', desc: '의료법 제24조의2 — 의료행위 설명·동의' } as CertMark,
  LAW34: { code: 'LAW:34',   label: '의료법 §34', category: 'LAW', desc: '의료법 제34조 — 원격의료' } as CertMark,
  // 개인정보보호
  PRIVACY: { code: 'PRIVACY', label: '개인정보보호', category: 'PRIVACY', desc: '개인정보보호법 — 민감정보 암호화·접근통제' } as CertMark,
};

// 경로(prefix) → 마크 매핑. 현재 경로가 패턴으로 시작하면 해당 마크 적용(중복 시 합집합).
const ROUTE_MARKS: { prefix: string; marks: CertMark[] }[] = [
  { prefix: '/patients', marks: [M.EMR_RECORD, M.AOP, M.MOI, M.LAW22] },
  { prefix: '/encounter', marks: [M.EMR_RECORD, M.COP, M.LAW22] },
  { prefix: '/prescription', marks: [M.EMR_CPOE, M.MMU, M.IPSG3] },
  { prefix: '/cpoe', marks: [M.EMR_CPOE, M.MMU, M.IPSG3] },
  { prefix: '/orders', marks: [M.EMR_CPOE, M.MMU] },
  { prefix: '/pharmacy', marks: [M.MMU, M.IPSG3] },
  { prefix: '/admin/controlled-substance', marks: [M.MMU, M.IPSG3] },
  { prefix: '/surgery', marks: [M.ASC, M.IPSG4] },
  { prefix: '/operating-room', marks: [M.ASC, M.IPSG4] },
  { prefix: '/neurosurgery', marks: [M.ASC, M.COP] },
  { prefix: '/safety', marks: [M.QPS, M.IPSG1, M.IPSG2, M.IPSG6] },
  { prefix: '/quality', marks: [M.QPS, M.ACI] },
  { prefix: '/admin/qi', marks: [M.QPS, M.ACI] },
  { prefix: '/admin/analytics', marks: [M.QPS, M.MOI] },
  { prefix: '/satisfaction', marks: [M.PFR, M.QPS] },
  { prefix: '/consent', marks: [M.PFR, M.LAW24, M.EMR_SIGN] },
  { prefix: '/admin/audit', marks: [M.EMR_ACCESS, M.PRIVACY, M.MOI] },
  { prefix: '/admin/vip-patients', marks: [M.EMR_ACCESS, M.PRIVACY] },
  { prefix: '/admin/access-control', marks: [M.EMR_ACCESS, M.PRIVACY] },
  { prefix: '/admin/emr-cert', marks: [M.EMR_RECORD, M.ACI] },
  { prefix: '/admin/blockchain-cert', marks: [M.EMR_SIGN] },
  { prefix: '/medical-records', marks: [M.LAW21, M.MOI, M.EMR_RECORD] },
  { prefix: '/blood-bank', marks: [M.COP, M.IPSG1] },
  { prefix: '/admission', marks: [M.ACC] },
  { prefix: '/discharge', marks: [M.ACC, M.COP] },
  { prefix: '/emergency', marks: [M.ACC] },
  { prefix: '/triage', marks: [M.ACC] },
  { prefix: '/transfer', marks: [M.ACC] },
  { prefix: '/nursing', marks: [M.AOP, M.COP, M.IPSG6] },
  { prefix: '/nutrition', marks: [M.AOP, M.COP] },
  { prefix: '/dialysis', marks: [M.COP] },
  { prefix: '/radiation', marks: [M.COP] },
  { prefix: '/infection', marks: [M.PCI, M.IPSG5] },
  { prefix: '/hospice', marks: [M.COP] },
  { prefix: '/remote-consult', marks: [M.LAW34, M.COP] },
  { prefix: '/telehealth', marks: [M.LAW34] },
  { prefix: '/hira-edi', marks: [M.MOI] },
  { prefix: '/admin/hie-dashboard', marks: [M.MOI, M.LAW21] },
  { prefix: '/pathology', marks: [M.AOP, M.COP] },
  { prefix: '/imaging', marks: [M.AOP] },
  { prefix: '/lab', marks: [M.AOP, M.IPSG2] },
  { prefix: '/admin/sqe', marks: [M.SQE] },
  { prefix: '/admin/gld', marks: [M.GLD] },
  { prefix: '/workstation/consent', marks: [M.PFR, M.LAW24, M.EMR_SIGN] },
];

/** 현재 경로에 해당하는 인증마크 목록 (가장 구체적인 prefix 매칭, 중복 제거) */
export function getMarksForPath(pathname: string): CertMark[] {
  const matched = ROUTE_MARKS
    .filter((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/') || pathname.startsWith(r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  if (matched.length === 0) return [];
  // 가장 긴 prefix 1건 + 그와 동일 깊이의 마크를 합집합으로 (정확 매칭 우선)
  const top = matched[0];
  const byCode = new Map<string, CertMark>();
  for (const m of top.marks) byCode.set(m.code, m);
  return Array.from(byCode.values());
}
