/**
 * 운영 빌드용 대체 모듈 — 시드 환자 패널 자리에 들어간다.
 *
 * 🔴 `TestAccountPanel.stub.tsx` 와 같은 이유다: 조건부 렌더나 `dynamic(import())` 의 false 분기만으로는
 *    청크가 생성되어 MRN·생년월일이 산출물에서 그대로 검색된다. `next.config.ts` 가 모듈을 치환한다.
 */
export default function TestPatientPanelStub(): null {
  return null;
}
