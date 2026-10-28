import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'WERUBYHOSP — International Patients | Example, Korea',
  description: 'World-class healthcare for international patients on Example Island. Multilingual support, medical tourism, telemedicine, and FHIR-standard data exchange.',
  alternates: { languages: { ko: '/', en: '/en', zh: '/zh', ja: '/ja' } },
};

const LANGS = [
  { v: 'ko', l: '한국어', href: '/' },
  { v: 'en', l: 'English', href: '/en' },
  { v: 'zh', l: '中文', href: '/zh' },
  { v: 'ja', l: '日本語', href: '/ja' },
];

export default function EnLayout({ children }: { children: React.ReactNode }) {
  const cur = 'en';
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="bg-white/90 backdrop-blur-lg border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 flex items-center justify-between h-[64px]">
          <Link href="/en" className="flex items-center gap-3 shrink-0" aria-label="WERUBYHOSP International">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-9 w-auto max-w-none" />
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-[13px] font-semibold text-gray-600">
            <a href="#services" className="px-3 py-2 rounded-lg hover:text-blue-700 hover:bg-blue-50/60 whitespace-nowrap">Services</a>
            <a href="#process" className="px-3 py-2 rounded-lg hover:text-blue-700 hover:bg-blue-50/60 whitespace-nowrap">How It Works</a>
            <a href="#languages" className="px-3 py-2 rounded-lg hover:text-blue-700 hover:bg-blue-50/60 whitespace-nowrap">Languages</a>
            <a href="#contact" className="px-3 py-2 rounded-lg hover:text-blue-700 hover:bg-blue-50/60 whitespace-nowrap">Contact</a>
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-0.5 text-[12px]">
              {LANGS.map(l => (
                <Link key={l.v} href={l.href}
                  className={`px-2 py-1 rounded-md whitespace-nowrap ${l.v === cur ? 'bg-blue-600 text-white font-semibold' : 'text-gray-500 hover:text-blue-600'}`}>
                  {l.l}
                </Link>
              ))}
            </div>
            <Link href="/booking" className="whitespace-nowrap px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-[13px] font-semibold rounded-xl hover:shadow-lg transition">
              Book
            </Link>
            <Link href="https://his.example.org/portal" className="hidden lg:flex whitespace-nowrap px-2 py-2 text-[13px] text-gray-500 hover:text-blue-600 font-medium">
              Patient Portal
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-gray-900 text-gray-400 text-sm">
        <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col md:flex-row justify-between gap-6">
          <div>
            <div className="text-white font-bold text-base mb-1">Weruby Hospital</div>
            <p className="text-gray-500">126, Example-ro, Example City, South Korea 00000</p>
            <p className="text-gray-500">+82-2-000-0000 · international@hospital.example.org</p>
          </div>
          <div className="flex gap-6 text-gray-400">
            <Link href="/" className="hover:text-white">한국어 사이트</Link>
            <Link href="/booking" className="hover:text-white">Book</Link>
            <Link href="https://his.example.org/portal" className="hover:text-white">Patient Portal</Link>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-gray-600">© WERUBYHOSP. All rights reserved.</div>
      </footer>
    </div>
  );
}
