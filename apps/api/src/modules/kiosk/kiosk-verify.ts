/** 생년월일 본인확인(순수) — 저장 DOB(YYYYMMDD)와 입력(YYYYMMDD/YYMMDD) 비교. */
export function dobMatches(patientDobYyyymmdd: string, input: string): boolean {
  const i = (input ?? '').replace(/[-.\s]/g, '').trim();
  if (!i) return false;
  return i.length === 6 ? patientDobYyyymmdd.slice(2) === i : patientDobYyyymmdd === i;
}
