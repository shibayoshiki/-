const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright');

let browser, server, baseUrl;
before(async () => {
  const assets = {
    '/': ['index.html', 'text/html'],
    '/b.html': ['b.html', 'text/html'],
    '/app.js': ['app.js', 'text/javascript']
  };
  server = createServer((request, response) => {
    const asset = assets[request.url];
    if (!asset) { response.writeHead(404).end(); return; }
    const [file, type] = asset;
    response.setHeader('Content-Type', type + '; charset=utf-8');
    response.end(readFileSync(new URL('../' + file, 'file://' + __filename)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

async function withPage(run) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  try {
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function login(page, id) {
  await page.fill('#login-id', id);
  await page.click('#do-login');
  await page.click('#home-open');
}

async function enterIdentity(page) {
  await page.fill('#student-name', '架空 生徒');
  await page.selectOption('#student-grade', '高校1年');
  await page.fill('#student-class', '1組');
}

async function findByUniversity(page) {
  const name = await page.evaluate(() => db.teachers[0].support.find(x => x.uni).uni);
  await enterIdentity(page);
  await page.click('#nav-next');
  await page.locator('#purpose-choices button').first().click();
  await page.click('#nav-next');
  await page.uncheck('#student-uni-uni-undecided');
  await page.fill('#student-uni-uni', name);
  await page.click('#nav-next');
  await page.click('#nav-next');
  await page.locator('#match-results article').first().waitFor();
}

async function setWriteFailure(page, key) {
  await page.evaluate(key => {
    window.blockedStorageKey = key;
    window.originalSetItem ??= Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === window.blockedStorageKey) throw new DOMException('Simulated failure', 'QuotaExceededError');
      return window.originalSetItem.call(this, name, value);
    };
  }, key);
}

test('A版の大学名のみの検索、Teamsコピー、再ログイン', () => withPage(async page => {
  await page.goto(baseUrl);
  assert.match(await page.locator('#version-label').innerText(), /A/);
  await login(page, 'S1001');
  await findByUniversity(page);
  assert.equal(await page.getByRole('button', { name: 'この先生の予定表を見る' }).count(), 0);
  await page.locator('#match-results article button').first().click();
  const template = await page.inputValue('#teams-text');
  assert.match(template, /架空 生徒/);
  await page.click('#teams-copy');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), template);
  await page.click('#logout');
  await login(page, 'S1001');
  assert.equal(await page.locator('#step-1').isVisible(), true);
  assert.equal(await page.inputValue('#student-name'), '架空 生徒');
}));

test('B版の予定編集の失敗・再試行と希望日時入りの文面、A/Bの保存分離', () => withPage(async page => {
  await page.goto(baseUrl + '/b.html');
  assert.match(await page.locator('#version-label').innerText(), /B/);
  await login(page, 'T1001');
  const slot = page.locator('#teacher-schedule button.cell-edit').first();
  const original = await slot.innerText();
  await setWriteFailure(page, 'edition_b_teacher_matching_fresh_v1');
  await slot.click();
  assert.equal(await slot.innerText(), original);
  assert.match(await page.locator('#schedule-save-msg').innerText(), /保存できませんでした/);
  await setWriteFailure(page, null);
  await slot.click();
  assert.notEqual(await slot.innerText(), original);
  await page.click('#logout');
  await login(page, 'S1001');
  await findByUniversity(page);
  await page.getByRole('button', { name: 'この先生の予定表を見る' }).first().click();
  const calendar = page.locator('#match-results .calendar');
  await page.locator('#match-results').getByRole('button', { name: /翌週|次の週|次週/ }).click();
  await page.locator('#match-results .calendar button:enabled').first().click();
  await page.getByRole('button', { name: 'この日時でTeams文面を作成' }).click();
  assert.match(await page.inputValue('#teams-text'), /希望日時：.+\d{2}:\d{2}/);
  assert.equal(await calendar.isVisible(), true);
  assert.match(await page.locator('#match-results').innerText(), /最終調整はTeams/);
  await page.goto(baseUrl);
  await login(page, 'S1001');
  assert.equal(await page.inputValue('#student-name'), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('teacher_matching_fresh_v1')), null);
}));

test('保存失敗で学習歴・相談対応情報・分類・生徒入力を保持し、再試行で1件だけ保存', () => withPage(async page => {
  await page.goto(baseUrl);
  await login(page, 'T1001');
  const key = 'teacher_matching_fresh_v1';
  const forms = [
    { fields: { 'history-university': '架空学習大学', 'history-major': '架空専攻' }, button: 'history-add', status: 'history-msg', list: 'history-list' },
    { fields: { 'support-uni': '架空相談大学' }, button: 'support-add', status: 'support-msg', list: 'teacher-uni-list' },
    { fields: { 'catalog-ja': '架空分類' }, button: 'catalog-add', status: 'catalog-msg', list: 'my-additions' }
  ];
  await page.selectOption('#catalog-kind', 'category');
  for (const { fields, button, status, list } of forms) {
    const label = Object.values(fields)[0];
    for (const [id, value] of Object.entries(fields)) await page.fill('#' + id, value);
    await setWriteFailure(page, key);
    await page.click('#' + button);
    assert.match(await page.locator('#' + status).innerText(), /^保存できませんでした/);
    assert.equal(await page.inputValue('#' + Object.keys(fields)[0]), label);
    assert.equal(await page.locator('#' + list).getByText(label).count(), 0);
    await setWriteFailure(page, null);
    await page.click('#' + button);
    assert.match(await page.locator('#' + status).innerText(), /^保存しました/);
    assert.equal(await page.inputValue('#' + Object.keys(fields)[0]), '');
    assert.equal(await page.locator('#' + list).getByText(label).count(), 1);
  }
  const requestDelete = page.getByRole('button', { name: '削除申請', exact: true });
  await setWriteFailure(page, key);
  await requestDelete.click();
  assert.match(await page.locator('#catalog-msg').innerText(), /保存できませんでした/);
  assert.equal(await requestDelete.isEnabled(), true);
  await setWriteFailure(page, null);
  await requestDelete.click();
  assert.match(await page.locator('#catalog-msg').innerText(), /保存しました/);
  await page.click('#logout');
  await login(page, 'A1001');
  assert.match(await page.locator('#admin-deletions').innerText(), /架空分類/);
  await page.getByRole('button', { name: '承認', exact: true }).click();
  assert.match(await page.locator('#admin-delete-msg').innerText(), /保存しました/);
  await page.click('#logout');
  await login(page, 'S1001');
  await enterIdentity(page);
  await setWriteFailure(page, 'teacher_matching_fresh_student_S1001');
  await page.click('#nav-next');
  assert.match(await page.locator('#student-identity-status').innerText(), /保存できませんでした/);
  assert.equal(await page.inputValue('#student-name'), '架空 生徒');
  await setWriteFailure(page, null);
  await page.click('#nav-next');
  assert.equal(await page.locator('#step-2').isVisible(), true);
}));

test('自由入力は正規化後の重複を加点せず、別項目の配点を維持', () => withPage(async page => {
  await page.goto(baseUrl);
  const result = await page.evaluate(() => {
    student.purpose = 'hsjob';
    student.freeTopics = 'Ａ・Ｂ、ab、別分野';
    student.freeCareers = '職業\n職　業';
    return matchTeacher({ purposes: ['hsjob'], freeTopics: 'AB、別分野', freeCareers: '職業' });
  });
  assert.equal(result.score, 12 * 2 + 14);
  assert.deepEqual(result.freeTopics, ['Ａ・Ｂ', '別分野']);
  assert.deepEqual(result.freeCareers, ['職業']);
}));

test('分類削除は子項目と選択参照だけを整理し、失敗時は承認待ちを保持', () => withPage(async page => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    const data = defaultDb();
    data.categories.push({ id: 'cat', ja: '架空大分類', kind: 'category' });
    data.subcategories.push({ id: 'sub', category: 'cat', ja: '架空中分類' });
    data.customItems.push(
      { id: 'child', ja: '子分野', groups: ['cat'], subcategory: 'sub', kind: 'topic' },
      { id: 'peer', ja: '残る分野', groups: ['cat'], kind: 'topic' },
      { id: 'shared', ja: '共通資格', groups: ['cat', 'it'], kind: 'qualification' }
    );
    data.teachers[0].topicIds = ['child', 'peer', 'shared'];
    data.deletionRequests.push({ id: 'subRequest', itemId: 'sub' }, { id: 'childRequest', itemId: 'child' }, { id: 'catRequest', itemId: 'cat' });
    localStorage.setItem(KEY, JSON.stringify(data));
    localStorage.setItem(STUDENT_PREFIX + 'S1001', JSON.stringify({ name: '架空 生徒', topicIds: ['child', 'peer', 'shared'], note: '保持' }));
    localStorage.setItem(STUDENT_PREFIX + 'S1002', JSON.stringify({ name: '架空 生徒2', topicIds: ['peer', 'shared'], note: '保持' }));
  });
  await page.reload();
  await login(page, 'A1001');
  const key = 'teacher_matching_fresh_v1';
  const firstApprove = page.getByRole('button', { name: '承認', exact: true }).first();
  await setWriteFailure(page, key);
  await firstApprove.click();
  assert.match(await page.locator('#admin-delete-msg').innerText(), /保存できませんでした/);
  assert.equal(await page.getByRole('button', { name: '承認', exact: true }).count(), 3);
  await setWriteFailure(page, null);
  await firstApprove.click();
  const read = () => page.evaluate(() => ({
    data: JSON.parse(localStorage.getItem(KEY)),
    first: JSON.parse(localStorage.getItem(STUDENT_PREFIX + 'S1001')),
    second: JSON.parse(localStorage.getItem(STUDENT_PREFIX + 'S1002'))
  }));
  let state = await read();
  assert.deepEqual(state.data.teachers[0].topicIds, ['peer', 'shared']);
  assert.deepEqual(state.data.deletionRequests.map(x => x.id), ['catRequest']);
  assert.deepEqual(state.first, { name: '架空 生徒', topicIds: ['peer', 'shared'], note: '保持' });

  await setWriteFailure(page, 'teacher_matching_fresh_student_S1002');
  await firstApprove.click();
  state = await read();
  assert.deepEqual(state.data.teachers[0].topicIds, ['shared']);
  assert.deepEqual(state.data.customItems.map(x => [x.id, x.groups]), [['shared', ['it']]]);
  assert.deepEqual(state.first.topicIds, ['shared']);
  assert.deepEqual(state.second.topicIds, ['peer', 'shared']);
  await page.click('#logout');
  await login(page, 'S1002');
  assert.deepEqual(await page.evaluate(() => student.topicIds), ['shared']);
  await setWriteFailure(page, null);
  await enterIdentity(page);
  await page.click('#nav-next');
  assert.deepEqual((await read()).second.topicIds, ['shared']);
}));
