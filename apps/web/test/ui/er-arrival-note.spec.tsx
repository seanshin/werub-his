import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const post = vi.fn();
const get = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn() }) }));

import EmergencyUnknownRegisterPage from '../../src/app/(main)/patients/register/emergency/page';
import { EMPTY_ARRIVAL, toArrivalPayload } from '../../src/app/(main)/patients/register/emergency/ArrivalNoteFields';
import { ArrivalNotesPanel, type ArrivalNoteRow } from '../../src/app/(main)/patients/[id]/components/ArrivalNotesPanel';

/**
 * 🔴 응급 미확인 등록의 "도착 상황 메모" — 종전엔 API 가 검증 후 **버렸다**(저장 0 · 보여주는 화면 없음 · 2026-09-29 실측).
 *   ① 등록 화면이 구조화 기록을 `arrival` 로 보낸다(빈 기록은 보내지 않는다 · 모르는 시각은 보내지 않는다)
 *   ② 환자 상세 패널은 첫 기록·추가 기록을 시간순으로, **적힌 칸만** 보여 준다
 */
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('입력 → 본문', () => {
  it('빈 입력은 빈 본문 · 공백 품목은 뺀다 · 시각이 비면 보내지 않는다', () => {
    expect(toArrivalPayload(EMPTY_ARRIVAL)).toEqual({});
    const p = toArrivalPayload({ ...EMPTY_ARRIVAL, arrivalMode: 'POLICE', belongings: [{ item: ' 지갑 ', custody: 'HANDED_TO_POLICE' }, { item: '  ', custody: 'UNKNOWN' }], note: '  ' });
    expect(p).toEqual({ arrivalMode: 'POLICE', belongings: [{ item: '지갑', custody: 'HANDED_TO_POLICE' }] });
    expect('arrivalAt' in p).toBe(false);
  });
});

describe('등록 화면', () => {
  beforeEach(() => { post.mockReset(); push.mockReset(); post.mockResolvedValue({ data: { id: 'p-new', mrn: 'EMG-260929-AB12', givenName: 'EMG-X', arrivalNoteId: 'n1' } }); });

  it('🔴 도착 상황을 적으면 arrival 로 보낸다 · 등록 후 그 환자 상세로', async () => {
    wrap(<EmergencyUnknownRegisterPage />);
    fireEvent.click(screen.getByText('119 구급차'));
    fireEvent.click(screen.getByText('추락'));
    fireEvent.click(screen.getByText('화상'));
    fireEvent.change(screen.getByPlaceholderText(/발견했고/), { target: { value: '공사장 2층에서 추락 — 동료 신고' } });
    fireEvent.click(screen.getAllByText('응급 미확인 환자 등록').at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/v1/patients/emergency-unknown');
    expect(body.arrival).toEqual({ arrivalMode: 'AMBULANCE_119', injuryTypes: ['FALL', 'BURN'], circumstance: '공사장 2층에서 추락 — 동료 신고' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/patients/p-new'));
  });

  it('🔴 119 사전통보 불러오기 — 초안으로 채우고 출처 id 를 보낸다 · 도착 처리는 체크해야만(기본 꺼짐)', async () => {
    get.mockResolvedValue({ data: [{ id: 'pre-1', source: 'EMS_119', unitId: '가상시119', etaRemainingMins: 5, patientAge: 60, patientGender: 'M', chiefComplaint: '의식 저하', severityHint: null, note: '길에서 발견', receivedAt: '2026-09-29T00:00:00Z' }] });
    wrap(<EmergencyUnknownRegisterPage />);
    fireEvent.click(await screen.findByText(/의식 저하/));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getAllByText('응급 미확인 환자 등록').at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ gender: 'MALE', estimatedAge: 60, prenotificationId: 'pre-1', markPrenotificationArrived: false });
    expect(body.arrival).toMatchObject({ arrivalMode: 'AMBULANCE_119', emsUnit: '가상시119', infoSource: 'EMS', note: '길에서 발견' });
    expect(body.arrival.circumstance).toContain('의식 저하');
    get.mockReset();
  });

  it('아무것도 적지 않으면 arrival 을 보내지 않는다(빈 기록을 만들지 않게) · 초기값은 전부 미선택', async () => {
    wrap(<EmergencyUnknownRegisterPage />);
    expect(document.querySelectorAll('.border-indigo-500, .border-red-500').length).toBe(0);
    fireEvent.click(screen.getAllByText('응급 미확인 환자 등록').at(-1)!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].arrival).toBeUndefined();
  });
});

const note = (over: Partial<ArrivalNoteRow>): ArrivalNoteRow => ({
  id: 'n', kind: 'INITIAL', createdAt: '2026-09-29T00:10:00Z', recordedByName: '김간호',
  arrivalAt: null, arrivalMode: null, emsUnit: null, foundLocation: null, foundAt: null, circumstance: null, consciousness: null,
  injuryTypes: null, companionType: null, companionName: null, companionContact: null, companionRelation: null, belongings: null, identifyingFeatures: null,
  policeInvolved: null, policeAgency: null, policeOfficer: null, policeCaseNo: null, infoSource: null, note: null, ...over,
});

describe('환자 상세 — 도착 상황 기록 패널', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it('첫 기록 → 추가 기록 시간순 · 적힌 칸만(비어 있는 칸을 "없음"으로 그리지 않는다)', async () => {
    get.mockResolvedValue({ data: { patientSource: 'EMERGENCY_UNKNOWN', notes: [
      note({ id: 'a', arrivalMode: 'AMBULANCE_119', emsUnit: '가상시119', note: '의식 저하' }),
      note({ id: 'b', kind: 'ADDENDUM', infoSource: 'POLICE', policeInvolved: true, policeCaseNo: '2026-777', belongings: [{ item: '지갑', custody: 'HOSPITAL_STORED' }] }),
    ] } });
    wrap(<ArrivalNotesPanel patientId="p1" />);
    expect(await screen.findByText(/119 구급차 · 가상시119/)).toBeTruthy();
    expect(screen.getAllByText('첫 기록').length).toBeGreaterThan(0);
    expect(screen.getByText('추가 기록 1')).toBeTruthy();
    expect(screen.getByText(/2026-777/)).toBeTruthy();
    expect(screen.getByText('지갑(병원 보관)')).toBeTruthy();
    expect(screen.queryByText('발견 장소')).toBeNull(); // 적지 않은 칸은 없다
    expect(screen.getAllByText('경찰 관여')).toHaveLength(1);
  });

  it('추가 기록 — 빈 기록은 저장 버튼이 잠긴다 · 저장하면 POST', async () => {
    get.mockResolvedValue({ data: { patientSource: 'EMERGENCY_UNKNOWN', notes: [note({ id: 'a', note: 'x' })] } });
    post.mockResolvedValue({ data: { id: 'c' } });
    wrap(<ArrivalNotesPanel patientId="p1" />);
    fireEvent.click(await screen.findByText('추가 기록'));
    const save = screen.getByText('기록 저장').closest('button')!;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/그 밖에 남길 것/), { target: { value: '보호자 연락됨 — 내일 방문' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/patients/p1/arrival-notes', { note: '보호자 연락됨 — 내일 방문' }));
  });
});
