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
    '/app.js': ['app.js', 'text/javascript'],
    '/matching.js': ['matching.js', 'text/javascript'],
    '/related-teachers.js': ['related-teachers.js', 'text/javascript']
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
  await page.getByRole('button', { name: 'Teams用の申込文を作る', exact: true }).first().click();
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
    return Matching.rank(student,[{ purposes: ['hsjob'], freeTopics: 'AB、別分野', freeCareers: '職業' }],allTopics(),careers)[0];
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
    data.teachers[0].practiceTopicIds = ['child', 'peer'];
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
  assert.deepEqual(state.data.teachers[0].practiceTopicIds, ['peer']);
  assert.deepEqual(state.data.deletionRequests.map(x => x.id), ['catRequest']);
  assert.deepEqual(state.first, { name: '架空 生徒', topicIds: ['peer', 'shared'], note: '保持' });

  await setWriteFailure(page, 'teacher_matching_fresh_student_S1002');
  await firstApprove.click();
  state = await read();
  assert.deepEqual(state.data.teachers[0].topicIds, ['shared']);
  assert.deepEqual(state.data.teachers[0].practiceTopicIds, []);
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

test('A版とB版で同条件・同教員データの順位と推薦理由が一致', () => withPage(async page => {
  const views = [];
  for (const path of ['/', '/b.html']) {
    await page.goto(baseUrl + path);
    await login(page, 'T1001');
    await page.fill('#support-uni', '架空星空大学');
    await page.fill('#support-fac', '情報科学学部');
    await page.fill('#support-dep', '情報工学学科');
    await page.selectOption('#support-kind', 'study');
    await page.selectOption('#support-source', 'attendance');
    await page.click('#support-add');
    assert.match(await page.locator('#support-msg').innerText(), /保存しました/);
    await page.locator('#teacher-career-experience').locator('..').locator('summary').click();
    const experience = page.locator('#teacher-career-experience input').first();
    const career = await experience.locator('..').innerText();
    await experience.check();
    await page.click('#teacher-save');
    await page.click('#logout');

    await login(page, 'T1002');
    await page.fill('#support-uni', '架空星空大学');
    await page.check('#support-wide');
    await page.click('#support-add');
    assert.match(await page.locator('#teacher-uni-list').innerText(), /大学全般の相談に対応可能/);
    await page.click('#logout');

    await login(page, 'S1001');
    await enterIdentity(page);
    await page.click('#nav-next');
    await page.locator('#purpose-choices button').first().click();
    await page.selectOption('#student-university-intent', 'campus');
    await page.click('#nav-next');
    for (const [id, value] of [['uni', '架空星空大学'], ['fac', '情報科学学部'], ['dep', '情報工学学科']]) {
      await page.uncheck('#student-uni-' + id + '-undecided');
      await page.fill('#student-uni-' + id, value);
    }
    await page.click('#nav-next');
    await page.fill('#student-free-careers', career.split('：')[1]);
    await page.click('#nav-next');

    const headings = await page.locator('#match-results article h3').allTextContents();
    const reasons = await page.locator('#match-results article .reasons').allTextContents();
    assert.equal(headings.length, 2);
    assert.match(headings[0], /経済担当A/);
    assert.match(reasons[0], /完全一致.*自身が在学・卒業した経験.*職業の実務経験/);
    assert.match(reasons[1], /相談対応情報は未登録.*大学全般の相談に対応可能/);
    views.push({ headings, reasons });
    await page.click('#logout');
  }
  assert.deepEqual(views[0], views[1]);
}));

for (const path of ['/', '/b.html']) {
  test(`${path} の推薦理由はカードごとに表示・収納でき、登録情報と一致する`, () => withPage(async page => {
    await page.goto(baseUrl + path);
    await page.evaluate(() => {
      const data = defaultDb();
      const acting = baseTopics.find(item => item.en === 'Acting').id;
      const teacher = (id, name, support, practiceTopicIds = []) => ({
        id, name, purposes: ['university'], topicIds: [acting], practiceTopicIds, support
      });
      data.teachers = [
        teacher('T1011', '実技担当（架空）', [
          { uni: '架空星空大学', kind: 'admissions', source: 'successfulGuidance' },
          { uni: '架空別大学', fac: '舞台芸術学部', kind: 'study', source: 'attendance' }
        ], [acting]),
        teacher('T1012', '一般担当（架空）', [
          { uni: '架空星空大学', fac: '理学部', kind: 'study', source: 'attendance' }
        ]),
        teacher('T1013', '分野担当（架空）', [
          { uni: '架空星空', fac: '舞台芸術学部', kind: 'admissions', source: 'application' }
        ])
      ];
      data.teachers[0].intro = '演技の相談を受け付けています。';
      localStorage.setItem(KEY, JSON.stringify(data));
    });
    await page.reload();
    await login(page, 'S1001');
    await enterIdentity(page);
    await page.click('#nav-next');
    await page.locator('#purpose-choices button').first().click();
    await page.click('#nav-next');
    for (const [id, text] of [['uni', '架空星空大学'], ['fac', '舞台芸術学部']]) {
      await page.uncheck('#student-uni-' + id + '-undecided');
      await page.fill('#student-uni-' + id, text);
    }
    await page.click('#nav-next');
    await page.fill('#student-free-topics', 'Acting');
    await page.click('#nav-next');
    const cards = page.locator('#match-results article');
    const first = cards.filter({ hasText: '実技担当（架空）' });
    const other = cards.filter({ hasText: '一般担当（架空）' });
    const overview = first.locator('.recommendation-overview');
    const detailed = first.locator('.recommendation-details');
    assert.equal(await first.getByText('演技の相談を受け付けています。').isVisible(), true);
    assert.match(await first.locator('.recommendation-brief').innerText(), /入試・出願相談/);
    for (const card of await cards.all()) {
      assert.equal(await card.locator('.recommendation-overview').isVisible(), false);
      assert.equal(await card.getByRole('button', { name: '表示', exact: true }).getAttribute('aria-expanded'), 'false');
    }
    await detailed.getByRole('button', { name: '表示', exact: true }).click();
    assert.equal(await overview.isVisible(), true);
    assert.equal(await other.locator('.recommendation-overview').isVisible(), false);
    const summary = await overview.innerText();
    assert.match(summary, /相談できる内容.*入試・出願相談/s);
    assert.match(summary, /希望条件との一致.*架空星空大学.*演技/s);
    assert.match(summary, /登録されている知識・経験.*合格者を指導した経験.*専門分野の実務経験/s);
    assert.match(summary, /照合した登録で未登録の項目.*学部・学群.*対応の有無が分からない/s);
    assert.doesNotMatch(summary, /自身が在学・卒業した経験|学科・専攻/);

    assert.match(await detailed.locator('.reasons').innerText(), /学部・学群：相談対応情報は未登録/);
    assert.equal(await first.locator('details').last().locator('p').first().isVisible(), false);

    await other.getByRole('button', { name: '表示', exact: true }).click();
    assert.equal(await overview.isVisible(), true);
    await detailed.getByRole('button', { name: '閉じる', exact: true }).click();
    assert.equal(await overview.isVisible(), false);
    assert.equal(await other.locator('.recommendation-overview').isVisible(), true);
    const conflict = await other.locator('.recommendation-overview').innerText();
    assert.match(conflict, /相談前に確認したいこと.*異なる登録/s);
    assert.match(conflict, /知識・経験の詳細は、照合した登録から確認できません/);
    assert.doesNotMatch(conflict, /照合した登録で未登録の項目|自身が在学・卒業した経験/);

    const partialCard = cards.filter({ hasText: '分野担当（架空）' });
    await partialCard.getByRole('button', { name: '表示', exact: true }).click();
    const partial = await partialCard.locator('.recommendation-overview').innerText();
    assert.match(partial, /名称が部分一致/);
    assert.doesNotMatch(partial, /自身が大学を受験した経験/);

    await page.click('#lang-en');
    await first.getByRole('button', { name: 'Show', exact: true }).click();
    assert.match(await first.locator('.recommendation-overview').innerText(), /Listed consultation topics.*Guidance of successful applicants/s);
  }));
}

test('A版・B版でクラス単位の利用許可、発行IDでのログイン、再発行の防止', () => withPage(async page => {
  for (const path of ['/', '/b.html']) {
    await page.goto(baseUrl + path);
    const storageKey = await page.evaluate(() => KEY);
    await login(page, 'A1001');
    const grant = page.getByRole('button', { name: 'このクラスを一括で許可' });
    const group = page.getByLabel('対象クラス');
    const preview = page.locator('#admin-group-preview');
    const issued = page.locator('#admin-group-ids');
    assert.equal(await grant.isDisabled(), true);

    await page.click('#admin-create-student');
    assert.match(await page.locator('#admin-student-msg').innerText(), /S1003/);
    await group.selectOption('class1a');
    assert.match(await preview.innerText(), /対象は5人/);
    assert.equal(await grant.isEnabled(), true);
    assert.equal(await issued.innerText(), '');
    await setWriteFailure(page, storageKey);
    await grant.click();
    assert.match(await page.locator('#admin-group-status').innerText(), /保存できませんでした/);
    assert.match(await preview.innerText(), /対象は5人/);
    assert.equal(await grant.isEnabled(), true);
    assert.equal(await issued.innerText(), '');

    await setWriteFailure(page, null);
    await grant.click();
    assert.match(await preview.innerText(), /5人分の利用を許可済み/);
    assert.equal(await grant.isDisabled(), true);
    const firstIds = (await issued.innerText()).match(/S\d+/g);
    assert.deepEqual(firstIds, ['S1004', 'S1005', 'S1006', 'S1007', 'S1008']);
    await page.getByRole('button', {name:'生徒IDをまとめてコピー'}).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), firstIds.join('\n'));

    await page.reload();
    await page.click('#home-open');
    await group.selectOption('class1a');
    assert.deepEqual((await issued.innerText()).match(/S\d+/g), firstIds);
    assert.equal(await grant.isDisabled(), true);
    await group.selectOption('class1b');
    assert.match(await preview.innerText(), /対象は8人/);
    await grant.click();
    assert.match(await preview.innerText(), /8人分の利用を許可済み/);
    const secondIds = (await issued.innerText()).match(/S\d+/g);
    assert.equal(secondIds.length, 8);
    assert.equal(new Set([...firstIds, ...secondIds]).size, 13);

    await page.click('#logout');
    await login(page, firstIds[0]);
    assert.equal(await page.locator('#step-1').isVisible(), true);
    assert.equal(await page.inputValue('#student-name'), '');
    await page.click('#logout');
  }
}));

test('A版・B版で通常結果と関連教員が別枠になり、既存の相談操作を利用できる', () => withPage(async page => {
  for (const [path,width] of [['/',390],['/b.html',1280]]) {
    await page.setViewportSize({ width, height:844 });
    await page.goto(baseUrl + path);
    await login(page, 'S1001');
    await enterIdentity(page);
    await page.click('#nav-next');
    await page.locator('#purpose-choices button').first().click();
    await page.click('#nav-next');
    await page.uncheck('#student-uni-fac-undecided');
    await page.fill('#student-uni-fac','経済学部');
    await page.click('#nav-next');
    await page.click('#nav-next');

    const direct=page.locator('#match-results article h3');
    const pickup=page.locator('#related-results article');
    assert.deepEqual(await direct.allTextContents(),['経済担当A先生（架空）']);
    assert.deepEqual(await pickup.locator('h3').allTextContents(),['情報担当D先生（架空）']);
    assert.match(await pickup.locator('.related-reason').innerText(),/経済学部.*専門分野：統計学/s);
    assert.doesNotMatch(await pickup.locator('.related-reason').innerText(),/経済学部.*完全一致/s);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),width);
    const otherWidth=width===390?1280:390;
    await page.setViewportSize({width:otherWidth,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),otherWidth);
    assert.equal(await page.locator('#admin-student-groups').isVisible(),false);
    await page.getByText('面接練習をしたい方へ',{exact:true}).click();
    assert.equal(await page.getByText(/複数の先生から異なる視点/).isVisible(),true);

    if(path==='/'){
      await pickup.getByRole('button',{name:'Teams用の申込文を作る'}).click();
      assert.match(await page.inputValue('#teams-text'),/情報担当D先生/);
    }else{
      await pickup.getByRole('button',{name:'この先生の予定表を見る'}).click();
      await pickup.getByRole('button',{name:/次の週/}).click();
      await pickup.locator('.calendar button:enabled').first().click();
      await pickup.getByRole('button',{name:'この日時でTeams文面を作成'}).click();
      assert.match(await page.inputValue('#teams-text'),/情報担当D先生[\s\S]*希望日時/);
    }

    await page.click('#redo-search');
    await page.click('#nav-back');
    await page.fill('#student-uni-fac','架空・拾わない学部');
    await page.click('#nav-next');
    await page.click('#nav-next');
    assert.equal(await pickup.count(),0);
    assert.match(await page.locator('#related-results').innerText(),/根拠を確認できる先生は見つかりませんでした/);

    await page.click('#logout');
    await login(page,'S1001');
    assert.equal(await page.inputValue('#student-name'),'架空 生徒');
    await page.click('#logout');
  }
}));

test('教員の学習歴・相談対応を削除せず編集し、入力中の追加内容を保持する', () => withPage(async page => {
  await page.goto(baseUrl);
  await login(page,'T1001');
  await page.fill('#history-university','架空の追加途中の大学');
  await page.locator('#history-list').getByRole('button',{name:'編集',exact:true}).first().click();
  assert.equal(await page.inputValue('#history-university'),'架空大学');
  await page.fill('#history-major','架空の変更後の専攻');
  await page.click('#history-add');
  assert.match(await page.locator('#history-list').innerText(),/架空の変更後の専攻/);
  assert.equal(await page.inputValue('#history-university'),'架空の追加途中の大学');
  assert.equal(await page.locator('#history-list .university-entry').count(),1);

  await page.locator('#teacher-uni-list').getByRole('button',{name:'編集',exact:true}).first().click();
  await page.fill('#support-year','2024');
  await page.click('#support-cancel');
  assert.equal(await page.inputValue('#support-year'),'');
  assert.doesNotMatch(await page.locator('#teacher-uni-list').innerText(),/2024/);

  await page.locator('#teacher-uni-list').getByRole('button',{name:'編集',exact:true}).first().click();
  await page.fill('#support-fac','架空の変更後の学部');
  await setWriteFailure(page,await page.evaluate(() => KEY));
  await page.click('#support-add');
  assert.match(await page.locator('#support-msg').innerText(),/保存できませんでした/);
  assert.equal(await page.inputValue('#support-fac'),'架空の変更後の学部');
  assert.doesNotMatch(await page.locator('#teacher-uni-list').innerText(),/架空の変更後の学部/);
  await setWriteFailure(page,null);
  await page.click('#support-add');

  await page.reload();
  await page.click('#home-open');
  assert.match(await page.locator('#teacher-uni-list').innerText(),/架空の変更後の学部/);
  assert.equal(await page.locator('#teacher-uni-list .university-entry').count(),1);
  assert.match(await page.locator('#history-list').innerText(),/架空の変更後の専攻/);
}));
