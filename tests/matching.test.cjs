const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const Matching = runInNewContext(readFileSync(join(__dirname, '../matching.js'), 'utf8') + '\nMatching');
const uni = { uni: '架空星空大学', fac: '情報科学学部', dep: '情報工学学科' };
const teacher = (id, support = [], extra = {}) => ({ id, purposes: ['university', 'gradjob', 'hsjob'], support, ...extra });
const student = (query = {}, extra = {}) => ({ purpose: 'university', uni: query, ...extra });
const topics = [
  { id: 'programming', ja: 'プログラミング', en: 'Programming', kind: 'topic' },
  { id: 'exam', ja: '架空情報検定', en: 'Demo IT Exam', kind: 'qualification' }
];
const careers = [{ id: 'dev', ja: 'プログラマー', en: 'Programmer' }];
const rank = (query, teachers) => Matching.rank(query, teachers, topics, careers);
const ids = results => Array.from(results, result => result.teacher.id);

test('完全一致・未登録・大学全般・明示的不一致を区別して順位付け', () => {
  const results = rank(student(uni), [
    teacher('missing', [{ uni: uni.uni }]),
    teacher('conflict', [{ uni: uni.uni, fac: '経済学部', dep: '経営学科', kind: 'admissions', source: 'successfulGuidance' }]),
    teacher('wide', [{ uni: uni.uni, scope: 'university' }]),
    teacher('full', [{ ...uni, kind: 'admissions', source: 'successfulGuidance' }])
  ]);
  assert.deepEqual(ids(results), ['full', 'wide', 'missing', 'conflict']);
  assert.deepEqual({ ...results[0].uni.states }, { uni: 'exact', fac: 'exact', dep: 'exact' });
  assert.equal(results[0].uni.sourcePoints, 16);
  assert.equal(results[1].uni.wide, true);
  assert.equal(results[2].uni.states.fac, 'unregistered');
  assert.equal(results[2].uni.states.dep, 'unregistered');
  assert.equal(results[3].uni.states.fac, 'different');
  assert.equal(results[3].uni.states.dep, 'different');
  assert.equal(results[3].uni.sourcePoints, 0);
});

test('大学のみ・学部のみ・学科のみで検索できる', () => {
  for (const field of Object.keys(uni)) {
    const [result] = rank(student({ [field]: uni[field] }), [teacher('t', [uni])]);
    assert.equal(result.uni.all, true);
    for (const key of Object.keys(uni)) assert.equal(result.uni.states[key], key === field ? 'exact' : 'unspecified');
  }
});

test('同一教員の別大学の登録や異なる学部の同名学科を合成しない', () => {
  const [result] = rank(student(uni), [teacher('t', [
    { ...uni, uni: '架空海辺大学' }, { uni: uni.uni, fac: '経済学部', dep: uni.dep }
  ])]);
  assert.equal(result.uni.record.uni, uni.uni);
  assert.equal(result.uni.all, false);
  assert.equal(result.uni.score, 30); // 46 university points minus 16 for explicit faculty conflict.
  assert.deepEqual(ids(rank(student(uni), [teacher('other', [{ ...uni, uni: '架空海辺大学' }])])), []);
});

test('表記正規化と限定的な部分一致を区別し、似た別名称を完全一致にしない', () => {
  const [exact, partial] = rank(student({ uni: ' Ｄｅｍｏ Ｔｅｃｈ 大学 ' }), [
    teacher('exact', [{ uni: 'Demo Tech大学' }]),
    teacher('partial', [{ uni: 'Demo Tech', kind: 'admissions', source: 'successfulGuidance' }]),
    teacher('other', [{ uni: 'Demo Tech理工大学' }])
  ]);
  assert.equal(exact.uni.states.uni, 'exact');
  assert.equal(partial.uni.states.uni, 'partial');
  assert.equal(partial.uni.sourcePoints, 0);
  assert.deepEqual(ids(rank(student({ fac: '情報科学学部' }), [teacher('other', [{ fac: '情報科学学群' }])])), []);
});

test('職業のみ、分野のみ、資格のみ、大学と職業の複合条件を評価', () => {
  const t = [
    teacher('university', [uni]),
    teacher('fields', [], { topicIds: ['programming', 'exam'], practiceTopicIds: ['programming'] }),
    teacher('career', [], { careerIds: ['dev'], experiencedCareerIds: ['dev'] }),
    teacher('combined', [uni], { careerIds: ['dev'] })
  ];
  assert.deepEqual(ids(rank(student({}, { purpose: 'hsjob', freeCareers: 'Ｐｒｏｇｒａｍｍｅｒ' }), t)), ['career', 'combined']);
  const [field] = rank(student({}, { freeTopics: 'Programming', topicIds: ['programming'] }), t);
  assert.equal(field.score, 24);
  assert.equal(field.topicMatches[0].practical, true);
  const [exam] = rank(student({}, { topicIds: ['exam'] }), t);
  assert.equal(exam.topicMatches[0].qualification, true);
  assert.deepEqual(ids(rank(student(uni, { careerIds: ['dev'] }), t)), ['combined', 'university', 'career']);
  assert.deepEqual(ids(rank(student({}, { freeTopics: '存在しない専門分野' }), t)), []);
});

test('同じ条件でも入試・大学生活・卒業後の就職の目的で首位が変わる', () => {
  const t = [
    teacher('admissions', [{ ...uni, kind: 'admissions', source: 'successfulGuidance' }]),
    teacher('campus', [{ ...uni, kind: 'study', source: 'attendance' }]),
    teacher('job', [{ ...uni, kind: 'career', source: 'careerGuidance' }], { careerIds: ['dev'], experiencedCareerIds: ['dev'] })
  ];
  const query = { careerIds: ['dev'] };
  assert.equal(rank(student(uni, query), t)[0].teacher.id, 'admissions');
  assert.equal(rank(student(uni, { ...query, universityIntent: 'campus' }), t)[0].teacher.id, 'campus');
  assert.equal(rank(student(uni, { ...query, purpose: 'gradjob' }), t)[0].teacher.id, 'job');
  assert.equal(rank(student(uni, { ...query, purpose: 'hsjob' }), t)[0].score, 51);
});

test('従来の兼用ラベルから在学・受験・合格者指導の個別経験を推定しない', () => {
  const t = [
    teacher('legacy', [{ ...uni, kind: 'admissions', source: 'guidance' }]),
    teacher('academicOnly', [], { academic: [{ university: uni.uni, type: 'primary' }] }),
    teacher('unsupported', [uni], { purposes: ['hsjob'] })
  ];
  const results = rank(student(uni), t);
  assert.deepEqual(ids(results), ['legacy']);
  assert.equal(results[0].uni.record.source, 'guidance');
});
