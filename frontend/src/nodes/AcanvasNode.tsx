'use client';

import { memo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Check, Copy, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BaseNode } from './BaseNode';
import { GroupFrame } from './GroupFrame';
import { getNodeDef } from './registry';
import { useAppStore, useNodeState } from '@/store';
import type { AcNode } from '@/types/canvas';
import { cn } from '@/lib/cn';
import { slugify } from '@/persistence/fileIO';

/**
 * 모든 노드 타입은 **레지스트리 기반 단일 컴포넌트**로 렌더링한다.
 * (Spec §5.1-1 "노드 정의는 한 곳에서만 선언한다" 의 컴포넌트 레벨 귀결.
 *  타입별 파일을 두면 정의가 두 곳으로 갈라진다.)
 * 본문 미리보기만 타입별로 분기한다.
 */
export const AcanvasNode = memo(function AcanvasNode({ id, selected }: NodeProps) {
  const node = useAppStore((s) => s.nodes.find((n) => n.id === id));
  if (!node) return null;
  // Group 만 카드가 아니라 자식을 담는 배경 프레임이다 (Spec §3.5-10).
  if (node.type === 'group') return <GroupFrame node={node} selected={Boolean(selected)} />;
  return (
    <BaseNode node={node} selected={Boolean(selected)}>
      <NodeBody node={node} />
    </BaseNode>
  );
});

function NodeBody({ node }: { node: AcNode }) {
  const def = getNodeDef(node.type);
  const runState = useNodeState(node.id);
  const d = node.data as Record<string, unknown>;

  switch (node.type) {
    case 'llm':
      return (
        <>
          <Row1>{String(d.provider ?? '').toUpperCase()} / {String(d.model ?? '')}</Row1>
          <Row2>temperature {String(d.temperature ?? '')}</Row2>
        </>
      );

    case 'agent':
      return (
        <>
          <Row1>{String(d.role || '역할 미지정')}</Row1>
          <Row2>{String(d.goal || '목표를 입력하세요')}</Row2>
          {Boolean(d.allow_delegation) && <span className="ac-chip">위임 허용</span>}
        </>
      );

    case 'task':
      return (
        <>
          <Row2>{String(d.description || '작업 설명을 입력하세요')}</Row2>
          {runState?.output && <OutputPeek text={runState.output} />}
        </>
      );

    case 'tool':
      return <Row1>{String(d.tool_id ?? '')}</Row1>;

    case 'crew':
      return (
        <>
          <Row1>{String(d.process ?? 'sequential')}</Row1>
          <Row2>
            {Boolean(d.memory) && 'memory · '}
            {Boolean(d.cache) && 'cache · '}
            {Boolean(d.planning) && 'planning'}
          </Row2>
        </>
      );

    case 'input':
      return (
        <>
          <Row1>{`{${String(d.var_name ?? '')}}`}</Row1>
          <Row2>{String(d.label ?? '')}{d.required ? ' · 필수' : ''}</Row2>
        </>
      );

    case 'output':
      return (
        <>
          <Row1>{String(d.title ?? '결과')}</Row1>
          {runState?.output
            ? (
              <OutputResult
                text={runState.output}
                renderAs={String(d.render_as ?? 'markdown')}
                allowDownload={Boolean(d.allow_download)}
                filename={slugify(String(d.title ?? 'output'))}
              />
            )
            : <Row2>실행이 끝나면 여기에 결과가 표시됩니다.</Row2>}
        </>
      );

    case 'knowledge':
      return (
        <>
          <Row1>{String(d.source_type ?? 'text')}</Row1>
          <Row2>{String(d.content || d.url || d.file_ref || '지식원을 지정하세요')}</Row2>
        </>
      );

    case 'memory':
      return (
        <Row2>
          {[d.short_term && '단기', d.long_term && '장기', d.entity && '엔티티']
            .filter(Boolean).join(' · ') || '비활성'}
        </Row2>
      );

    case 'human':
      return (
        <>
          <Row2>{String(d.prompt ?? '')}</Row2>
          <Row2>
            {`${Number(d.timeout_s ?? 300)}초 대기 · 초과 시 ${
              d.on_timeout === 'continue' ? '승인으로 간주' : '실행 중단'
            }`}
          </Row2>
        </>
      );

    case 'router':
    case 'guardrail':
      return (
        <>
          <Row2>{String(d.condition ?? d.type ?? '')}</Row2>
          <span className="ac-chip !text-amber">v1.1 예정 · 실행 제외</span>
        </>
      );

    case 'note':
      return (
        <div className="whitespace-pre-wrap text-t11_5 leading-normal text-text-dim">
          {String(d.text ?? '')}
        </div>
      );

    default:
      return <Row2>{def.description}</Row2>;
  }
}

function Row1({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-t12_5 font-bold text-text">
      {children}
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden text-t11_5 leading-tight text-text-faint"
      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
    >
      {children}
    </div>
  );
}

/**
 * Output 노드 본문 (Spec §5.9 "실행 완료 시 노드 본문이 확장되며 결과를
 * 렌더링"). `render_as` 별로 markdown/plain/json 을 그리고 우상단에 복사·
 * 다운로드 버튼을 둔다. 우측 로그 패널엔 별도 Result 탭이 없어(M3-T3 조사
 * 결과 — `rightTab` 타입만 있고 UI 자체가 없는 죽은 상태) 이 노드 본문이
 * 사실상 이 프로젝트의 "Result 뷰"다. 인스펙터 선택 시엔 M3-T3 가 만든
 * "실행 결과" 섹션에서 같은 값을 보게 되어 있어 별도 동기화 코드는 불필요.
 */
function OutputResult({
  text, renderAs, allowDownload, filename,
}: { text: string; renderAs: string; allowDownload: boolean; filename: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 접근이 막힌 환경(권한 거부 등) — 조용히 무시, 복사 버튼만 원상태 유지
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const isJson = renderAs === 'json';
    const blob = new Blob([text], { type: isJson ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${isJson ? 'json' : 'md'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={handleCopy}
          aria-label="결과 복사"
          title="결과 복사"
          className="rounded-md p-1 text-text-faint hover:bg-surface-3 hover:text-text"
        >
          {copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
        </button>
        {allowDownload && (
          <button
            type="button"
            onClick={handleDownload}
            aria-label="결과 다운로드"
            title="결과 다운로드"
            className="rounded-md p-1 text-text-faint hover:bg-surface-3 hover:text-text"
          >
            <Download size={12} />
          </button>
        )}
      </div>
      <div className="nowheel max-h-[240px] overflow-y-auto rounded-lg border border-border-soft bg-surface-2 p-2">
        {renderAs === 'markdown'
          ? <ReactMarkdown className="ac-markdown" remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          : <pre className="whitespace-pre-wrap font-mono text-t10_5 leading-relaxed text-text-dim">{formatOutput(text, renderAs)}</pre>}
      </div>
    </div>
  );
}

function formatOutput(text: string, renderAs: string): string {
  if (renderAs !== 'json') return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text; // 유효한 JSON 이 아니면 원문 그대로 (실행 결과가 항상 JSON이라는 보장 없음)
  }
}

/** 실행 결과 미리보기 — 노드 하단 접이식 영역 (Spec §10.3) */
function OutputPeek({ text, lines = 3 }: { text: string; lines?: number }) {
  return (
    <div
      className={cn(
        'mt-1 rounded-lg border border-border-soft bg-surface-2 p-2',
        'font-mono text-t10 leading-relaxed text-log-ok',
      )}
      style={{ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
    >
      {text}
    </div>
  );
}
