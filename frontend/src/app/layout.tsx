import type { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope, Sora } from 'next/font/google';
import './globals.css';

/* 아티팩트가 로드하는 3종 웨이트까지 그대로 (Spec §1.1 타이포그래피 복제) */
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});
const sora = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-sora',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AgentCanvas',
  description: '코딩 없이 드래그 앤 드롭으로 CrewAI 멀티 에이전트 팀을 설계하고 실행합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${manrope.variable} ${sora.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
