'use client';

// 외국인 구매자 셀프 "검진권 등록"(공개·무인증). 딜러에게 받은 시리얼+활성화코드로
// 코드검증→외국인환자·포털계정 생성→활성화→즉시 로그인(/portal). G1+G2.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ClaimResult {
  serial: string; status: string; balance: number; mrn: string;
  loginId: string; existingAccount: boolean; accessToken?: string;
}

async function postClaim(body: Record<string, unknown>) {
  const res = await fetch('/api/v1/portal/vouchers/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Request failed');
  return json.data as ClaimResult;
}

export default function VoucherClaimPage() {
  const router = useRouter();
  const [f, setF] = useState({
    serial: '', activationCode: '',
    familyName: '', givenName: '', nationality: '', passportNo: '', birthDate: '', gender: '',
    contact: '', email: '', password: '', pin: '', consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<ClaimResult | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });

  const submit = async () => {
    setErr('');
    if (!f.consent) { setErr('Please agree to the cross-border data transfer & terms (L8).'); return; }
    setBusy(true);
    try {
      const r = await postClaim({
        serial: f.serial.trim(), activationCode: f.activationCode.trim(), consent: f.consent,
        familyName: f.familyName.trim(), givenName: f.givenName.trim() || undefined,
        nationality: f.nationality.trim().toUpperCase(), passportNo: f.passportNo.trim(),
        birthDate: f.birthDate, gender: f.gender || undefined,
        contact: f.contact.trim() || undefined, email: f.email.trim() || undefined,
        password: f.password, pin: f.pin.trim() || undefined,
      });
      setDone(r);
      // 즉시 로그인: 토큰 저장 후 포털 이동
      if (r.accessToken) {
        localStorage.setItem('accessToken', r.accessToken);
        setTimeout(() => router.push('/portal'), 1200);
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-7 text-center">
          <div className="text-3xl mb-2">🎫</div>
          <h1 className="text-lg font-bold text-gray-900 mb-1">Voucher activated</h1>
          <p className="text-sm text-gray-500 mb-4 font-mono">{done.serial} · {done.status} · balance {done.balance.toLocaleString()}</p>
          {done.accessToken ? (
            <p className="text-xs text-gray-400">Signing you in… redirecting to your portal.</p>
          ) : done.existingAccount ? (
            <>
              <p className="text-sm text-gray-600 mb-3">An account already exists for this passport. Please sign in with your passport number.</p>
              <a href="/portal" className="inline-block px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg">Go to portal</a>
            </>
          ) : (
            <a href="/portal" className="inline-block px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg">Go to portal</a>
          )}
          <p className="mt-4 text-[11px] text-gray-400">Login ID (passport): <span className="font-mono">{done.loginId}</span> · MRN {done.mrn}</p>
        </div>
      </div>
    );
  }

  const input = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-100 outline-none';
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100 p-6 my-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Register your checkup voucher</h1>
        <p className="text-xs text-gray-400 mb-5">Enter the serial &amp; activation code from your dealer. For foreign patients only.</p>
        {err && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600">{err}</div>}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={f.serial} onChange={(e) => set('serial', e.target.value)} placeholder="Voucher serial" className={`${input} font-mono`} />
            <input value={f.activationCode} onChange={(e) => set('activationCode', e.target.value)} placeholder="Activation code" className={input} />
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase mb-2">Passport identity</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={f.familyName} onChange={(e) => set('familyName', e.target.value)} placeholder="Family name *" className={input} />
              <input value={f.givenName} onChange={(e) => set('givenName', e.target.value)} placeholder="Given name" className={input} />
              <input value={f.passportNo} onChange={(e) => set('passportNo', e.target.value)} placeholder="Passport no. *" className={input} />
              <input value={f.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder="Nationality (e.g. US, CN) *" maxLength={3} className={input} />
              <input value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} type="date" placeholder="Birth date *" className={input} />
              <select value={f.gender} onChange={(e) => set('gender', e.target.value)} className={input}>
                <option value="">Gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
              </select>
              <input value={f.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Phone (optional)" className={input} />
              <input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="Email (optional)" className={input} />
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase mb-2">Portal account · login ID = passport no.</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={f.password} onChange={(e) => set('password', e.target.value)} type="password" placeholder="Password (8+) *" className={input} />
              <input value={f.pin} onChange={(e) => set('pin', e.target.value)} placeholder="PIN (6 digits, optional)" maxLength={6} className={input} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-600 pt-1">
            <input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} className="mt-0.5" />
            <span>I agree to the cross-border transfer of my personal/health data and the voucher terms (L8). Eligible for foreign patients only (Medical Service Act §27 exception).</span>
          </label>
          <button onClick={submit} disabled={busy || !f.serial || !f.activationCode || !f.familyName || !f.passportNo || !f.nationality || !f.birthDate || f.password.length < 8 || !f.consent}
            className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Registering…' : 'Register & activate'}
          </button>
        </div>
      </div>
    </div>
  );
}
