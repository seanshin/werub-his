/**
 * 동의서 환자 서명 받기(2026-10-13 결함 발굴 A1).
 *  · 🔴 종전: `prompt('서명자 이름')` → `PATCH consent/:id/sign { patientSignedBy }` — 환자 서명 없이 "서명 완료"
 *  · 이제: 방식·이름 미선택으로 시작 · 서명패드는 그린 이미지 · 종이는 스캔본을 먼저 올리고 그 인덱스로 서명
 *  · 🔴 구조 가드: 환자 서명 EP 를 부르는 곳은 이 대화상자 하나 · 직원 화면에 이름 prompt 서명 경로가 없다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, useImperativeHandle } from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const api = vi.hoisted(() => ({ patch: vi.fn(async () => ({ data: {} })), postForm: vi.fn(async () => ({ data: { attachments: [{}, {}] } })), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
vi.mock('@/components/signature/SignaturePad', () => ({
  SignaturePad: forwardRef<unknown, { onChange?: (e: boolean) => void }>(function Fake({ onChange }, ref) {
    useImperativeHandle(ref, () => ({ toDataURL: () => PNG, clear: () => onChange?.(true), isEmpty: () => false }));
    return <button type="button" data-fake-draw onClick={() => onChange?.(false)}>draw</button>;
  }),
}));

beforeEach(() => { cleanup(); api.patch.mockClear(); api.postForm.mockClear(); });
const open = async () => {
  const { PatientConsentSignDialog } = await import('@/components/consent/PatientConsentSignDialog');
  const onSigned = vi.fn();
  const v = render(<PatientConsentSignDialog consentId="c1" onClose={() => {}} onSigned={onSigned} />);
  const save = () => v.container.querySelector('[data-patient-sign-save]') as HTMLButtonElement;
  const name = v.container.querySelector('[data-patient-sign-field="signedBy"]') as HTMLInputElement;
  return { v, save, name, onSigned };
};

describe('🔴 환자 서명 — 증거 없이 기록하지 않는다', () => {
  it('미선택으로 시작 · 이름만으로는 저장 불가 · 방식만 골라도 증거 전엔 저장 불가', async () => {
    const { v, save, name } = await open();
    expect(name.value).toBe('');
    expect(v.container.querySelector('[aria-checked="true"]')).toBeNull();
    fireEvent.change(name, { target: { value: '홍길동' } });
    expect(save().disabled).toBe(true);
    fireEvent.click(v.container.querySelector('[data-patient-sign-mode="PAD"]')!);
    expect(save().disabled).toBe(true);
    fireEvent.click(v.container.querySelector('[data-patient-sign-mode="PAPER"]')!);
    expect(save().disabled).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
  });
  it('서명패드 — 그린 이미지와 이름(공백 제거)을 보낸다', async () => {
    const { v, save, name, onSigned } = await open();
    fireEvent.change(name, { target: { value: ' 홍길동 ' } });
    fireEvent.click(v.container.querySelector('[data-patient-sign-mode="PAD"]')!);
    fireEvent.click(v.container.querySelector('[data-fake-draw]')!);
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/v1/consent/c1/sign', { patientSignedBy: '홍길동', signMode: 'PAD', patientSignature: PNG }));
    await waitFor(() => expect(onSigned).toHaveBeenCalled());
  });
  it('종이 — 스캔본을 먼저 올리고 올라간 마지막 첨부를 지목한다', async () => {
    const { v, save, name } = await open();
    fireEvent.change(name, { target: { value: '보호자 김' } });
    fireEvent.click(v.container.querySelector('[data-patient-sign-mode="PAPER"]')!);
    const f = new File(['x'], 'scan.pdf', { type: 'application/pdf' });
    fireEvent.change(v.container.querySelector('[data-patient-sign-field="scan"]')!, { target: { files: [f] } });
    fireEvent.click(save());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/v1/consent/c1/sign', { patientSignedBy: '보호자 김', signMode: 'PAPER', paperScanIndex: 1 }));
    expect((api.postForm.mock.calls[0] as unknown[])[0]).toBe('/api/v1/consent/c1/attachments');
  });
  it('🔴 실패는 말한다 — 서명 완료로 닫지 않는다', async () => {
    api.patch.mockRejectedValueOnce(new Error('환자 서명이 필요합니다'));
    const { v, save, name, onSigned } = await open();
    fireEvent.change(name, { target: { value: '홍길동' } });
    fireEvent.click(v.container.querySelector('[data-patient-sign-mode="PAD"]')!);
    fireEvent.click(v.container.querySelector('[data-fake-draw]')!);
    fireEvent.click(save());
    await waitFor(() => expect(v.container.querySelector('[data-patient-sign-error]')).toBeTruthy());
    expect(onSigned).not.toHaveBeenCalled();
  });
});

describe('🔴 구조 가드 — 환자 서명 EP 호출은 대화상자 하나', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
  it('`/api/v1/consent/${…}/sign` 을 부르는 파일 = PatientConsentSignDialog 뿐', () => {
    const root = join(__dirname, '../../src');
    const hits = walk(root).filter((f) => /\/api\/v1\/consent\/\$\{[^}]+\}\/sign`/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(root.length + 1))).toEqual(['components/consent/PatientConsentSignDialog.tsx']);
  });
});
