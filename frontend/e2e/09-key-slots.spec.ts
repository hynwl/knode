import { expect, test } from '@playwright/test';

import { dialog, field, gotoApp, node, seedCanvas, selectNode, toast } from './helpers';

/**
 * 키 슬롯 (Spec §12.1 / §12.4 MUST "키 없이 실행 시도 → 어떤 키가 왜 필요한지
 * 명확히 안내").
 *
 * 유닛 테스트가 못 잡는 것만 여기서 본다 — 검증 결과가 **키 저장소 변화에 반응해
 * 다시 도는지**(그래프는 그대로인데 키만 바뀐다), 그리고 노드 배지·인스펙터
 * 드롭다운·이슈 표시가 실제로 그 판정을 반영하는지.
 *
 * 실행은 하지 않는다. 이 시나리오의 요점은 "실행을 눌러 백엔드가 실패하기 전에
 * 알 수 있는가" 이기 때문이다.
 */

const LLM = 'llm_1';
const FAKE_MAIN = 'sk-e2eSLOTmainNOTreal0123456789abcd';
const FAKE_WORK = 'sk-e2eSLOTworkNOTreal0123456789abcd';

async function openKeys(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'API Keys', exact: true }).click();
  const keys = dialog(page, 'API Keys & local runtime');
  await expect(keys).toBeVisible();
  return keys;
}

test('키가 없으면 LLM 노드가 그 사실을 스스로 알리고, 키를 넣으면 즉시 사라진다', async ({ page }) => {
  await seedCanvas(page, [
    { id: LLM, type: 'llm', x: 120, y: 120, data: { provider: 'openai', model: 'gpt-4o-mini' } },
  ]);
  await gotoApp(page);

  // 1. 미등록 — 노드 배지가 색이 아니라 **문구**로 말한다 (§17.2).
  await expect(node(page, LLM)).toContainText('OPENAI_API_KEY not set');

  // 2. 키를 넣는다.
  const keys = await openKeys(page);
  await keys.getByPlaceholder(/Paste the API key/).fill(FAKE_MAIN);
  await keys.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(toast(page, 'Added the OpenAI key.')).toBeVisible();
  await keys.getByRole('button', { name: 'Done' }).click();

  // 3. 그래프는 한 글자도 안 바뀌었지만 판정이 다시 돌아야 한다.
  await expect(node(page, LLM)).toContainText('OPENAI_API_KEY');
  await expect(node(page, LLM)).not.toContainText('not set');
});

test('같은 프로바이더의 키를 여러 개 등록하고 블록마다 골라 쓴다', async ({ page }) => {
  await seedCanvas(page, [
    { id: LLM, type: 'llm', x: 120, y: 120, data: { provider: 'openai', model: 'gpt-4o-mini' } },
  ]);
  await gotoApp(page);

  const keys = await openKeys(page);
  await keys.getByPlaceholder(/Paste the API key/).fill(FAKE_MAIN);
  await keys.getByRole('button', { name: 'Add', exact: true }).click();

  // 두 번째 키는 별칭이 있어야 받는다 — 이름이 같으면 어느 쪽인지 고를 수 없다.
  await keys.getByPlaceholder(/Paste the API key/).fill(FAKE_WORK);
  await keys.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(toast(page, /already have a OpenAI key/)).toBeVisible();

  await keys.getByPlaceholder('e.g. work').fill('work');
  await keys.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(toast(page, 'Added the work key.')).toBeVisible();
  await keys.getByRole('button', { name: 'Done' }).click();

  // 인스펙터에서 슬롯을 고른다. 기본 슬롯은 빈 값과 같은 키라 목록에 중복으로 뜨지 않는다.
  await selectNode(page, LLM);
  const select = field(page, 'key_ref').locator('select');
  await expect(select.locator('option')).toHaveText([/Default · OPENAI_API_KEY/, 'work']);

  await select.selectOption({ label: 'work' });
  await expect(node(page, LLM)).toContainText('work');

  // 4. 노드에는 **이름만** 저장된다 — 키 값은 그래프에 절대 들어가지 않는다 (§12.1).
  // 자동 저장은 1초 디바운스라(`persistence/localStorage.ts`) 폴링으로 기다린다.
  const workspace = () => page.evaluate(() => window.localStorage.getItem('agentcanvas.workspace.v1') ?? '');
  await expect.poll(workspace, { timeout: 5000 }).toContain('OPENAI_API_KEY#work');
  expect(await workspace()).not.toContain(FAKE_WORK);
});

test('고른 키 슬롯이 사라지면 실행 전에 에러로 막는다 (기본 키로 몰래 폴백하지 않는다)', async ({ page }) => {
  await seedCanvas(page, [
    {
      id: LLM, type: 'llm', x: 120, y: 120,
      // 공유 링크/Import 로 남의 슬롯 이름이 들어온 상황과 같은 모양이다.
      data: { provider: 'openai', model: 'gpt-4o-mini', key_ref: 'OPENAI_API_KEY#gone' },
    },
  ]);
  await gotoApp(page);

  // 프로바이더 기본 키는 있지만, 노드가 지목한 슬롯은 없다.
  const keys = await openKeys(page);
  await keys.getByPlaceholder(/Paste the API key/).fill(FAKE_MAIN);
  await keys.getByRole('button', { name: 'Add', exact: true }).click();
  await keys.getByRole('button', { name: 'Done' }).click();

  // 경고가 아니라 에러다 — 서버 .env 로도 채워질 수 없는 이름이라 반드시 실패한다.
  await selectNode(page, LLM);
  await expect(page.getByText('AC-E606')).toBeVisible();
  await expect(node(page, LLM)).toContainText('OPENAI_API_KEY#gone not set');
});
