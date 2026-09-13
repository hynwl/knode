import type { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope, Sora } from 'next/font/google';
import { I18nBootstrap } from '@/i18n/react';
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

/**
 * ⚠️ 이 메타데이터는 **서버에서** 한 번 만들어져 로케일을 알 수 없다 (§17.3 범위 밖).
 * 문서 언어(`<html lang>`)는 `I18nBootstrap` 이 클라이언트에서 감지 후 바꿔 준다.
 */
export const metadata: Metadata = {
  title: 'Knode',
  description: 'Design and run CrewAI multi-agent teams by drag & drop, no code required. / 코딩 없이 드래그 앤 드롭으로 CrewAI 멀티 에이전트 팀을 설계하고 실행합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${manrope.variable} ${sora.variable} ${plexMono.variable}`}>
      <body>
        <I18nBootstrap />
        {children}
      </body>
    </html>
  );
}
