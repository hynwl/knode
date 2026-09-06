/** 에러 코드 체계 (Spec §22.1) — 프론트/백엔드 공통 어휘 */

import { getLocale, lookupExact, t, tk, type TranslateVars } from '@/i18n';

export type Severity = 'error' | 'warn';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  nodeId?: string | null;
  edgeId?: string | null;
  field?: string | null;
  /**
   * 코드만으로는 표현할 수 없는 **동적 메시지**(노드/필드 이름이 박힌 것)의 i18n 키.
   * `message` 는 백엔드 대조·변경 감지용으로 한국어 원문을 그대로 유지하고,
   * 화면에는 `issueText()` 가 이 키를 현재 로케일로 번역해 보여준다.
   */
  messageKey?: string;
  hintKey?: string;
  /**
   * ⚠️ 값도 **i18n 키로** 넣는다 (`node: 'node.agent.label'`).
   *
   * 검증은 그래프가 바뀔 때 한 번 돌지 로케일이 바뀔 때 다시 돌지 않는다.
   * 여기에 이미 번역된 문자열을 굳혀 넣으면 언어를 바꿔도 메시지 속 노드·필드
   * 이름만 옛 언어로 남는다(실제로 그렇게 만들었다가 브라우저 검증에서 잡혔다).
   * 그래서 `issueText()` 가 그릴 때마다 `tk()` 로 푼다 — 키가 아닌 값('{topic}' 등)은
   * 그대로 통과한다.
   */
  params?: TranslateVars;
}

interface IssueTemplate {
  severity: Severity;
  message: string;
  hint: string;
}

/**
 * Spec §22.1 전 코드.
 * 모든 에러는 코드 + 노드 + 다음 행동(hint) 세 가지를 갖는다. (Spec §17.4)
 */
export const ISSUE_CATALOG: Record<string, IssueTemplate> = {
  // E1xx — 그래프 구조
  'AC-E101': { severity: 'error', message: 'Crew 노드가 없습니다', hint: '우클릭 → Flow → Crew 를 추가하세요.' },
  'AC-E102': { severity: 'error', message: 'Crew 노드가 2개 이상입니다', hint: '하나만 남기세요.' },
  'AC-E103': { severity: 'error', message: 'hierarchical 프로세스에는 Manager LLM 이 필요합니다', hint: 'Crew 의 manager llm 소켓에 LLM 을 연결하세요.' },
  'AC-W104': { severity: 'warn', message: 'Crew 에 연결되지 않은 노드가 있습니다', hint: '실행에서 제외됩니다.' },
  'AC-E105': { severity: 'error', message: '순환 의존이 감지되었습니다', hint: 'Task 의 depends on 연결을 확인하세요.' },
  'AC-E106': { severity: 'error', message: '호환되지 않는 포트 연결입니다', hint: '같은 색 소켓끼리만 연결할 수 있습니다.' },
  'AC-E107': { severity: 'error', message: 'Crew 에 Task 가 없습니다', hint: '최소 1개의 Task 를 Crew 에 연결하세요.' },

  // E2xx — 노드 설정
  'AC-E201': { severity: 'error', message: '필수 항목이 비어 있습니다', hint: '역할·목표·배경을 모두 채우세요.' },
  'AC-E202': { severity: 'error', message: 'Task 에 Agent 가 연결되지 않았습니다', hint: 'Agent 의 출력을 Task 의 agent 소켓에 연결하세요.' },
  'AC-W203': { severity: 'warn', message: 'Agent 에 연결된 Task 가 없습니다', hint: '이 에이전트는 아무 일도 하지 않습니다.' },
  'AC-E204': { severity: 'error', message: 'Task 의 설명 또는 기대 산출물이 비어 있습니다', hint: '두 항목 모두 CrewAI 품질에 직접 영향을 줍니다.' },
  'AC-E205': { severity: 'error', message: '알 수 없는 툴입니다', hint: '툴 종류를 다시 선택하세요.' },
  'AC-E206': { severity: 'error', message: '툴 설정이 스키마에 맞지 않습니다', hint: '필수 설정값을 확인하세요.' },

  // E3xx — 변수/보간
  'AC-W301': { severity: 'warn', message: '정의되지 않은 변수를 참조합니다', hint: 'Input 노드를 추가하거나 변수명을 고치세요.' },
  'AC-E302': { severity: 'error', message: '필수 입력값이 제공되지 않았습니다', hint: '실행 파라미터를 채우세요.' },
  'AC-E303': { severity: 'error', message: '잘못된 변수명 형식입니다', hint: '영문으로 시작하고 영문·숫자·밑줄만 사용하세요.' },

  // E4xx — 파일/스키마
  'AC-E401': { severity: 'error', message: '지원하지 않는 스키마 버전입니다', hint: '파일이 손상되었을 수 있습니다.' },
  'AC-E402': { severity: 'error', message: '더 최신 버전에서 만든 파일입니다', hint: '앱을 업데이트하세요.' },
  'AC-E403': { severity: 'error', message: '파일이 손상되었거나 형식이 올바르지 않습니다', hint: 'JSON 구조를 확인하세요.' },
  'AC-E404': { severity: 'error', message: '파일에 API 키로 보이는 값이 포함되어 있습니다', hint: '해당 필드에서 키를 지운 뒤 다시 내보내세요.' },
  'AC-E405': { severity: 'error', message: 'LocalStorage 용량이 부족합니다', hint: '오래된 프로젝트를 정리하거나 파일로 내보내세요.' },
  'AC-E406': { severity: 'error', message: '지원하지 않는 문서 형식입니다', hint: 'PDF, DOCX, 또는 텍스트 파일(.txt/.md/.csv)을 올려주세요.' },
  'AC-E407': { severity: 'error', message: '문서 파일이 너무 큽니다', hint: '10MB 이하로 나누어 올리거나 필요한 부분만 잘라내세요.' },
  'AC-E408': { severity: 'error', message: '문서에서 텍스트를 추출하지 못했습니다', hint: '파일이 손상되었거나, 스캔 이미지라 텍스트 레이어가 없을 수 있습니다.' },

  // E5xx — 실행/런타임
  'AC-E501': { severity: 'error', message: '실행 중 오류가 발생했습니다', hint: '로그 패널에서 상세 내용을 확인하세요.' },
  'AC-E502': { severity: 'error', message: '최대 실행 시간을 초과했습니다', hint: '태스크를 나누거나 제한 시간을 늘리세요.' },
  'AC-E503': { severity: 'error', message: '동시 실행 한도를 초과했습니다', hint: '진행 중인 실행이 끝난 뒤 다시 시도하세요.' },
  'AC-E504': { severity: 'error', message: '백엔드에 연결할 수 없습니다', hint: '백엔드가 떠 있는지 확인하세요. 편집·저장은 계속 가능합니다.' },
  'AC-E505': { severity: 'error', message: '실행이 취소되었습니다', hint: '' },
  'AC-E506': { severity: 'error', message: '실행을 찾을 수 없습니다', hint: 'run_id를 확인하세요. 완료 후 30분이 지나면 기록이 사라집니다.' },
  'AC-E507': { severity: 'error', message: '사람 검토 대기 시간을 초과했습니다', hint: 'Human Input 노드의 대기 시간을 늘리거나, 시간 초과 동작을 승인으로 간주하고 계속으로 바꾸세요.' },
  'AC-E508': { severity: 'error', message: '대기 중인 사람 검토 요청이 없습니다', hint: '이미 응답했거나 시간이 초과된 요청입니다. 실행 로그를 확인하세요.' },

  // E6xx — 프로바이더/키
  'AC-E601': { severity: 'error', message: 'API 키가 유효하지 않습니다 (401/403)', hint: 'API Keys 설정에서 키를 다시 확인하세요.' },
  'AC-E602': { severity: 'error', message: '필요한 API 키가 설정되지 않았습니다', hint: 'API Keys 설정에서 키를 입력하세요.' },
  'AC-E603': { severity: 'error', message: '요청 한도(rate limit)에 도달했습니다', hint: '잠시 후 다시 시도하세요.' },
  'AC-E604': { severity: 'error', message: '모델을 찾을 수 없습니다', hint: '모델명을 확인하세요.' },
  'AC-E605': { severity: 'error', message: 'API 크레딧/쿼터가 소진되었습니다', hint: '프로바이더 콘솔에서 결제 정보와 잔액을 확인하세요.' },
  'AC-E606': { severity: 'error', message: '선택한 API 키 슬롯을 찾을 수 없습니다', hint: 'API Keys 에서 같은 이름의 키를 추가하거나, 이 노드의 키를 다시 고르세요.' },
  'AC-W606': { severity: 'warn', message: '이 노드에 필요한 API 키가 등록되지 않았습니다', hint: 'API Keys 에서 키를 추가하세요. 서버 .env 에 키가 있으면 그대로 실행됩니다.' },

  // E7xx — Ollama/로컬
  'AC-E701': { severity: 'error', message: 'Ollama 서버에 연결할 수 없습니다', hint: '터미널에서 `ollama serve` 를 실행하세요.' },
  'AC-W701': { severity: 'warn', message: '이 로컬 모델은 툴 호출이 불안정할 수 있습니다', hint: '툴을 쓰는 에이전트에는 더 큰 모델을 권장합니다.' },
  'AC-E702': { severity: 'error', message: '선택한 모델이 설치되어 있지 않습니다', hint: '`ollama pull <model>` 로 내려받으세요.' },

  // E8xx — 보안
  'AC-E801': { severity: 'error', message: '내부 네트워크 주소 접근이 차단되었습니다', hint: '공개 URL 을 사용하세요.' },
  'AC-E802': { severity: 'error', message: '작업 디렉터리 밖의 파일에 접근할 수 없습니다', hint: 'WORKSPACE_DIR 안의 경로를 지정하세요.' },
  'AC-E803': { severity: 'error', message: '코드 실행 도구가 비활성화되어 있습니다', hint: 'ENABLE_CODE_INTERPRETER 를 켜고 Docker 샌드박스를 준비하세요.' },
};

export function issue(
  code: keyof typeof ISSUE_CATALOG | string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  const template = ISSUE_CATALOG[code];
  return {
    code,
    severity: extra.severity ?? template?.severity ?? 'error',
    message: extra.message ?? template?.message ?? code,
    hint: extra.hint ?? template?.hint,
    nodeId: extra.nodeId ?? null,
    edgeId: extra.edgeId ?? null,
    field: extra.field ?? null,
    messageKey: extra.messageKey,
    hintKey: extra.hintKey,
    params: extra.params,
  };
}

/* ────────────────────────── 다국어 (Spec §17.3) ────────────────────────── */

/**
 * ⚠️ `ISSUE_CATALOG` 는 **건드리지 않는다.**
 * `backend/tests/test_schemas.py::test_issue_catalog_matches_frontend` 가 이 파일을
 * 정규식으로 파싱해 `backend/app/schemas/errors.py` 의 같은 카탈로그와 문자열을
 * 글자 단위로 대조한다. 그래서 다국어는 카탈로그를 번역하는 대신
 * **로케일별 오버라이드**로 얹는다 — `i18n/en.json` 의 `errors.<코드>.message|hint`.
 *
 * 그 결과가 §17.3 이 말한 "에러 메시지는 코드 기반 매핑이므로 자동으로 다국어
 * 지원됨" 이다. 백엔드가 내려보낸 이슈도 코드만 같으면 그대로 번역된다.
 */
function overrideFor(code: string, part: 'message' | 'hint'): string | undefined {
  return lookupExact(getLocale(), `errors.${code}.${part}`);
}

/** 치환값 중 i18n 키인 것들을 지금 로케일로 푼다. */
function resolveParams(params?: TranslateVars): TranslateVars | undefined {
  if (!params) return undefined;
  const out: TranslateVars = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === 'string' ? tk(v) : v;
  return out;
}

/**
 * 화면에 그릴 이슈 문구. 우선순위는
 *   1. `messageKey`/`hintKey` (동적 메시지 — 노드/필드 이름이 들어간 것)
 *   2. 현재 로케일의 `errors.<코드>` 오버라이드 — 단, `message` 가 카탈로그 기본값
 *      그대로일 때만. 호출부가 문구를 갈아끼웠다면 그쪽이 더 구체적이다.
 *   3. 원래 값 (= `ISSUE_CATALOG` 의 한국어)
 */
export function issueText(i: Pick<
  ValidationIssue, 'code' | 'message' | 'hint' | 'messageKey' | 'hintKey' | 'params'
>): { message: string; hint?: string } {
  const template = ISSUE_CATALOG[i.code];
  const params = resolveParams(i.params);

  let message: string;
  if (i.messageKey) message = t(i.messageKey, params);
  else if (i.message === template?.message) message = overrideFor(i.code, 'message') ?? i.message;
  else message = i.message;

  let hint: string | undefined;
  if (i.hintKey) hint = t(i.hintKey, params);
  else if (i.hint !== undefined && i.hint === template?.hint) hint = overrideFor(i.code, 'hint') ?? i.hint;
  else hint = i.hint;

  return { message, hint: hint || undefined };
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export const ALL_ISSUE_CODES = Object.keys(ISSUE_CATALOG);
