'use client';

import { color, colorExtra, nodeAccent, shadow, welcomeMidnight as mn } from '@design/tokens';
import { Black_Han_Sans, Noto_Sans_KR } from 'next/font/google';
import { useEffect } from 'react';
import { BrandLockup } from './Brand';

const REPO_URL = 'https://github.com/hynwl/agentcanvas';
const RELEASES_URL = 'https://github.com/hynwl/agentcanvas/releases';

/**
 * 이 화면 전용 포스터체 — 앱 나머지는 전부 Sora/Manrope(`layout.tsx`)라
 * 여기서만 새로 불러온다. `variable` 로만 등록해 두고 실제 적용은 아래
 * `<style jsx>` 안에서 `var(--font-black-han)` 로 참조한다.
 */
const blackHanSans = Black_Han_Sans({
  subsets: ['latin'], weight: '400', variable: '--font-black-han', display: 'swap',
});
/** 한글 본문 폴백 — Manrope 에는 한글 글리프가 없어 지정하지 않으면 시스템 기본체로 빠진다. */
const notoSansKR = Noto_Sans_KR({
  subsets: ['latin'], weight: ['400', '500'], variable: '--font-noto-kr', display: 'swap',
});

export interface WelcomeProps {
  onEnter: () => void;
}

/**
 * 첫 방문자용 오프닝 화면 — "Midnight" (디자인 아티팩트 원안을 이식).
 *
 * 원안은 정적 HTML/CSS 한 장(마케팅 스플래시)이라 그대로 붙이면 세 가지가
 * 실제 앱에서 깨진다:
 *   1. 언어 토글이 "한국어 · English" 정적 텍스트뿐이었다 — 이 앱은 런타임
 *      로케일 전환이 실제 기능(Spec §17.3)이라 `LocaleSwitcher` 를 헤더에 심었다.
 *   2. 히어로 CTA("무료로 시작하기")가 `#watch` 로 스크롤만 하는 앵커였다 —
 *      로컬로 뜬 실제 앱에서는 그 클릭이 캔버스로 들어가는 유일한 입구이므로
 *      `onEnter` 를 호출하는 버튼으로 바꿨다. 아래 "Live" 데모 구간은 스크롤해
 *      내려오는 사람을 위한 보충 설명으로 그대로 남긴다.
 *   3. 데모 자리의 목업 영상(원안 주석: "목업 영상 자리")은 자리표시자였다 —
 *      실제 데모(`public/demo.mp4`)로 채웠다. GIF 대신 비디오를 쓴 이유는 이 화면이
 *      GitHub README 와 달리 진짜 웹페이지라 `<video>` 가 그대로 되기 때문 —
 *      256색 팔레트 손실 없이 원본 해상도로, 파일 크기도 더 작다. "데스크톱 앱 다운로드(macOS·
 *      Windows)" 카드는 이 프로젝트에 실재하지 않는 빌드라 "릴리스 노트"로
 *      바꿔 사실과 다른 약속을 남기지 않았다.
 * 로고는 원안이 손으로 그린 것과 같은 마크라 새로 안 그리고 기존
 * `BrandLockup` 을 그대로 재사용한다. 색은 이 화면에만 등장하는 값만
 * `welcomeMidnight` 로 토큰화했고, 앱 팔레트와 겹치는 값(사이언/인디고
 * 그라디언트, 성공색 등)은 기존 토큰을 그대로 재사용했다 (AC-D2, Spec §21).
 */
export function Welcome({ onEnter }: WelcomeProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEnter(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEnter]);

  return (
    <div data-testid="welcome" className={`mn-root ${blackHanSans.variable} ${notoSansKR.variable}`}>
      <div className="screen1">
        <svg className="bg-graph" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="mn-w" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={color.runA} /><stop offset="1" stopColor={color.runB} />
            </linearGradient>
          </defs>
          <g fill="none" stroke="url(#mn-w)" strokeWidth={2.4}>
            <path d="M250,210 C330,210 260,380 340,380" />
            <path d="M250,640 C330,640 260,470 340,470" />
            <path d="M600,420 C680,420 610,250 690,250" />
            <path d="M600,460 C680,460 610,660 690,660" />
            <path d="M950,250 C1030,250 960,430 1040,430" />
            <path d="M950,660 C1030,660 960,500 1040,500" />
            <path d="M1300,465 C1380,465 1310,300 1390,300" />
          </g>
          <g stroke={mn.graphStroke} fill={mn.graphFill}>
            <rect x={90} y={160} width={160} height={100} rx={12} /><rect x={90} y={160} width={160} height={16} rx={8} fill={nodeAccent.human.base} stroke="none" />
            <rect x={90} y={590} width={160} height={100} rx={12} /><rect x={90} y={590} width={160} height={16} rx={8} fill={nodeAccent.tool.deep} stroke="none" />
            <rect x={340} y={330} width={260} height={180} rx={14} /><rect x={340} y={330} width={260} height={20} rx={10} fill={nodeAccent.agent.deep} stroke="none" />
            <rect x={690} y={200} width={260} height={120} rx={14} /><rect x={690} y={200} width={260} height={18} rx={9} fill={nodeAccent.task.deep} stroke="none" />
            <rect x={690} y={600} width={260} height={120} rx={14} /><rect x={690} y={600} width={260} height={18} rx={9} fill={nodeAccent.task.deep} stroke="none" />
            <rect x={1040} y={380} width={260} height={170} rx={14} /><rect x={1040} y={380} width={260} height={20} rx={10} fill={nodeAccent.output.deep} stroke="none" />
            <rect x={1390} y={230} width={180} height={140} rx={14} /><rect x={1390} y={230} width={180} height={18} rx={9} fill={nodeAccent.agent.deep} stroke="none" />
          </g>
          <g fill={colorExtra.logOk}>
            <circle cx={250} cy={210} r={7} /><circle cx={250} cy={640} r={7} /><circle cx={340} cy={380} r={7} />
            <circle cx={340} cy={470} r={7} /><circle cx={600} cy={420} r={7} /><circle cx={600} cy={460} r={7} />
            <circle cx={690} cy={250} r={7} /><circle cx={690} cy={660} r={7} /><circle cx={950} cy={250} r={7} />
            <circle cx={950} cy={660} r={7} /><circle cx={1040} cy={430} r={7} /><circle cx={1040} cy={500} r={7} />
            <circle cx={1300} cy={465} r={7} /><circle cx={1390} cy={300} r={7} />
          </g>
        </svg>
        <div className="glow" aria-hidden="true" />
        <div className="vignette" aria-hidden="true" />

        <div className="s1-top">
          <div className="wrap">
            <BrandLockup size="header" />
            <a className="ml-auto ghost" href={REPO_URL} target="_blank" rel="noreferrer noopener">GITHUB</a>
          </div>
        </div>

        <div className="s1-mid">
          <div className="wrap">
            <BrandLockup size="hero" />
            <h1 className="phrase">Sketch, Connect, <em>Cowork</em></h1>
            <p className="s1-subtitle">
              CrewAI 에이전트 팀을 코드 없이 캔버스에서 조립하고,<br />실행되는 과정을 그래프 위에서 그대로 지켜보세요.
            </p>
            <button type="button" className="cta" onClick={onEnter}>Get Started!</button>
          </div>
        </div>
      </div>

      <section className="features">
        <div className="wrap features-wrap">
          <p className="features-eyebrow">Features</p>
          <h2 className="features-title">무엇을 할 수 있나</h2>
          <div className="features-grid" data-testid="features-section">
            <div className="feature-card feature-card-media">
              <div className="feature-icon">🎨</div>
              <h3>캔버스에서 크루 조립</h3>
              <p>14종 노드로 에이전트·태스크·도구를 시각적으로 연결. 타입이 맞는 소켓만 연결되고, Ctrl+K로 검색해 빠르게 추가할 수 있습니다.</p>
              <div className="feature-media">
                <video src="/feature-assemble.mp4" aria-label="노드 라이브러리에서 노드를 추가하고 소켓을 연결해 크루를 조립하는 모습" autoPlay loop muted playsInline />
              </div>
            </div>
            <div className="feature-card feature-card-media">
              <div className="feature-icon">📤</div>
              <h3>언제든 코드로 탈출</h3>
              <p>Export to Python으로 순수 CrewAI 코드를 내보냅니다. 캔버스에 락인되지 않습니다.</p>
              <div className="feature-media">
                <video src="/feature-export.mp4" aria-label="가장 복잡한 템플릿을 불러온 뒤 Export Code를 눌러 실제로 생성된 CrewAI 파이썬 코드를 끝까지 스크롤해 보여주는 모습" autoPlay loop muted playsInline />
              </div>
            </div>
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3>실행을 그래프 위에서 실시간으로</h3>
              <p>SSE 스트리밍으로 에이전트의 각 단계가 노드 위에서 라이브로 펼쳐집니다. 실패한 노드는 바로 표시되고, 사고와 도구 호출이 콘솔에 흘러옵니다.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔐</div>
              <h3>API 키는 내 브라우저에만</h3>
              <p>BYOK: 키는 세션 메모리에만 존재하고, 그래프 파일에는 절대 저장되지 않습니다. 로그에서도 자동으로 마스킹됩니다.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">💰</div>
              <h3>Ollama로 무료 로컬 실행</h3>
              <p>로컬 Ollama가 있으면 API 키 없이, 계정 없이, $0으로 완전 오프라인 실행이 가능합니다.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📋</div>
              <h3>실행 전에 리허설</h3>
              <p>Dry Run으로 실행 순서와 예상 비용만 먼저 확인하고, 실제 LLM 호출 없이 결과를 봅니다.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="screen2" id="watch">
          <p className="eyebrow">Live</p>
          <h2>Quick Demo</h2>

          <div className="player">
            <div className="player-bar">
              <i className="tl" /><i className="tl" /><i className="tl" />
              <span>localhost:3000 — blog_seo_crew.acanvas.json</span>
            </div>
            <div className="stage">
              <video src="/demo.mp4" aria-label="Knode 편집 화면에서 크루가 실행되는 모습" autoPlay loop muted playsInline />
            </div>
          </div>

          <div className="dl">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.19c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" /></svg>
              <span><b>Visit our GitHub!</b><span>AGPL-3.0 · docker compose up</span></span>
              <span className="arrow">↗</span>
            </a>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></svg>
              <span><b>MAC OS / Windows Download</b><span>버전별 변경 사항</span></span>
              <span className="arrow">↗</span>
            </a>
          </div>
        </section>

        <footer>
          <span>AGPL-3.0</span><span>CrewAI 1.15.18</span>
        </footer>
      </div>

      <style jsx>{`
        .mn-root {
          --ui: var(--font-noto-kr), 'Manrope', system-ui, sans-serif;
          --poster: var(--font-black-han), 'Sora', sans-serif;
          --run: linear-gradient(96deg, ${color.runA}, ${color.runB});
          position: fixed; inset: 0; z-index: 400; overflow-y: auto; overflow-x: hidden;
          background: ${mn.bg}; color: ${color.text};
          font-family: var(--ui); font-size: 15px; line-height: 1.6;
          -webkit-font-smoothing: antialiased;
        }
        .mn-root :global(a) { color: inherit; }
        .mn-root :global(*:focus-visible) { outline: 2px solid ${color.runA}; outline-offset: 4px; border-radius: 6px; }
        .wrap { max-width: 1200px; margin: 0 auto; padding: 0 28px; }

        .screen1 { position: relative; overflow: hidden; min-height: clamp(600px, 92vh, 880px); display: flex; flex-direction: column; }
        .bg-graph {
          position: absolute; inset: -6% -4%; width: 108%; height: 112%;
          opacity: .22; filter: blur(1.1px); animation: mn-drift 34s ease-in-out infinite alternate; pointer-events: none;
        }
        @keyframes mn-drift { from { transform: translate3d(-10px,-6px,0) scale(1); } to { transform: translate3d(14px,10px,0) scale(1.03); } }
        .glow {
          position: absolute; left: 50%; top: 44%; transform: translate(-50%,-50%);
          width: min(1100px,120%); height: 620px; pointer-events: none;
          background: radial-gradient(50% 50% at 50% 50%, ${mn.glowInner} 0%, ${mn.glowOuter} 42%, transparent 72%);
        }
        .vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(78% 62% at 50% 46%, transparent 34%, ${mn.bg} 92%); }

        .s1-top { position: relative; z-index: 3; padding: 26px 0; }
        .s1-top :global(.wrap) { display: flex; align-items: center; gap: 16px; }
        .ghost {
          font-family: var(--font-noto-kr), monospace; font-size: 11px; letter-spacing: 1px;
          color: ${color.textDim}; border: 1px solid ${color.borderSoft}; border-radius: 20px; padding: 7px 14px;
          text-decoration: none; transition: border-color .12s, color .12s;
        }
        .ghost:hover { border-color: ${color.runA}; color: ${color.text}; }

        .s1-mid { position: relative; z-index: 3; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px 0 40px; }
        .s1-mid :global(.wrap) { width: 100%; display: flex; flex-direction: column; align-items: center; }
        .phrase {
          font-family: 'Sora', sans-serif; font-weight: 700;
          font-size: clamp(23px,3.3vw,42px); line-height: 1.2; letter-spacing: -1.2px;
          margin: 30px 0 0; text-wrap: balance;
        }
        .phrase em { font-style: normal; background: var(--run); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .cta {
          display: inline-flex; align-items: center; justify-content: center; margin-top: 38px;
          font-weight: 700; font-size: 14.5px; letter-spacing: .6px; border: none;
          padding: 15px 36px; border-radius: 999px; background: var(--run); color: ${colorExtra.runInk};
          box-shadow: ${shadow.runBtn};
          transition: filter .15s;
        }
        .cta:hover { filter: brightness(1.1); }

        .s1-subtitle { font-size: 15px; line-height: 1.6; color: ${color.textDim}; margin: 20px 0 0; font-family: var(--font-noto-kr), 'Manrope', system-ui, sans-serif; }

        .features { padding: 80px 0; position: relative; background: transparent; }
        .features-wrap { display: flex; flex-direction: column; align-items: center; }
        .features-eyebrow { font-family: var(--font-noto-kr), monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 1.8px; text-transform: uppercase; color: ${color.runA}; text-align: center; margin: 0; }
        .features-title { font-family: var(--poster); font-weight: 400; margin: 14px 0 48px; font-size: clamp(26px,3.4vw,42px); letter-spacing: -1px; text-align: center; line-height: 1.15; }
        .features-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; width: 100%; margin: 0; }
        @media (max-width: 760px) { .features-grid { grid-template-columns: 1fr; gap: 16px; } }
        .feature-card { display: flex; flex-direction: column; padding: 28px; border: 1px solid ${mn.line}; border-radius: 16px; background: ${mn.cardBg}; transition: border-color .16s, background .16s, transform .16s; text-decoration: none; color: inherit; }
        .feature-card:hover { border-color: ${color.runA}; background: ${mn.cardBgHover}; transform: translateY(-2px); }
        .feature-icon { font-size: 32px; line-height: 1; margin-bottom: 12px; }
        .feature-card h3 { display: block; font-family: 'Sora', sans-serif; font-weight: 600; font-size: 16.5px; margin: 0 0 10px; color: ${color.text}; }
        .feature-card p { display: block; margin: 0; font-family: var(--font-noto-kr), 'Manrope', system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: ${color.textDim}; }

        /* 실제 앱 화면(영상/스크린샷)을 붙인 카드 — 1번 "캔버스에서 크루 조립", 6번 "언제든 코드로 탈출".
           둘 다 전체 폭을 차지해 미디어가 작아지지 않게 한다 — 나머지 4장은 2열 그대로. */
        .feature-card-media { grid-column: 1 / -1; }
        .feature-card-media .feature-media { max-width: 640px; }
        @media (max-width: 760px) { .feature-card-media .feature-media { max-width: none; } }
        .feature-media {
          margin-top: 18px; border: 1px solid ${mn.line}; border-radius: 12px; overflow: hidden;
          background: ${mn.panelBg}; box-shadow: ${mn.playerShadow};
        }
        .feature-media :global(video), .feature-media :global(img) {
          display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; background: ${mn.stageGradB};
        }

        .screen2 { padding: 96px 0 0; position: relative; }
        .eyebrow { font-family: var(--font-noto-kr), monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 1.8px; text-transform: uppercase; color: ${color.runA}; text-align: center; }
        h2 { font-family: var(--poster); font-weight: 400; margin: 14px 0 0; font-size: clamp(26px,3.4vw,42px); letter-spacing: -1px; text-align: center; line-height: 1.15; }

        .player { margin-top: 38px; border: 1px solid ${mn.line}; border-radius: 18px; overflow: hidden; background: ${mn.panelBg}; box-shadow: ${mn.playerShadow}; }
        .player-bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; background: ${mn.panelHeadBg}; border-bottom: 1px solid ${mn.panelHeadBorder}; }
        .tl { width: 9px; height: 9px; border-radius: 50%; background: ${mn.line}; }
        .player-bar span { font-family: var(--font-noto-kr), monospace; font-size: 11px; color: ${color.textFaint}; margin-left: 10px; }
        .stage { position: relative; aspect-ratio: 16/9; width: 100%; background: radial-gradient(${mn.stageDot} 1.3px,transparent 1.3px) 0 0/24px 24px, radial-gradient(120% 90% at 50% 0%, ${mn.stageGradA} 0%, ${mn.stageGradB} 74%); }
        .stage :global(video) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

        .dl { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 34px; }
        @media (max-width: 760px) { .dl { grid-template-columns: 1fr; } }
        .dl :global(a) { display: flex; align-items: center; gap: 16px; text-decoration: none; padding: 20px 24px; border: 1px solid ${mn.line}; border-radius: 16px; background: ${mn.cardBg}; transition: border-color .16s, background .16s, transform .16s; }
        .dl :global(a:hover) { border-color: ${color.runA}; background: ${mn.cardBgHover}; transform: translateY(-2px); }
        .dl :global(svg) { width: 26px; height: 26px; flex: none; color: ${color.text}; }
        .dl :global(b) { display: block; font-family: 'Sora', sans-serif; font-weight: 600; font-size: 15.5px; }
        .dl :global(span span) { display: block; margin-top: 3px; font-family: var(--font-noto-kr), monospace; font-size: 11px; color: ${color.textFaint}; letter-spacing: .4px; }
        .dl :global(.arrow) { margin-left: auto; color: ${color.textFaint}; font-size: 18px; }

        footer { margin-top: 80px; border-top: 1px solid ${mn.footerBorder}; padding: 24px 0 46px; display: flex; gap: 10px 22px; flex-wrap: wrap; align-items: center; font-family: var(--font-noto-kr), monospace; font-size: 11px; color: ${color.textFaint}; letter-spacing: .4px; }
      `}
      </style>
    </div>
  );
}
