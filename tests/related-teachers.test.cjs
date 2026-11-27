const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const RelatedTeachers = runInNewContext(readFileSync(join(__dirname,'../related-teachers.js'),'utf8')+'\nRelatedTeachers');
const topics=[
  {id:'film',ja:'映像制作',en:'Film production',kind:'topic'},
  {id:'stats',ja:'統計学',en:'Statistics',kind:'topic'},
  {id:'welfare',ja:'社会福祉学',en:'Social welfare',kind:'topic'},
  {id:'ux',ja:'UXデザイン',en:'UX design',kind:'topic'},
  {id:'dance',ja:'ダンス',en:'Dance',kind:'topic'}
];
const careers=[
  {id:'nurse',ja:'看護師',en:'Nurse'},
  {id:'coder',ja:'プログラマー',en:'Software engineer'}
];
const teacher=(id,values)=>({id,purposes:['university','hsjob','gradjob'],...values});
const pick=(query,teachers,direct=[])=>RelatedTeachers.pick({purpose:'university',...query},teachers,topics,careers,direct);
const ids=results=>Array.from(results,item=>item.teacher.id);

test('学科・分野・職業から分野をまたいだ関係を抽出',()=>{
  const teachers=[
    teacher('film',{topicIds:['film']}),
    teacher('research',{topicIds:['stats']}),
    teacher('welfare',{topicIds:['welfare']}),
    teacher('ux',{topicIds:['ux']}),
    teacher('dance',{topicIds:['dance']})
  ];
  assert.deepEqual(ids(pick({uni:{dep:'舞台芸術学科'}},teachers)),['film']);
  assert.deepEqual(ids(pick({freeTopics:'Ｄａｔａ　ｓｃｉｅｎｃｅ'},teachers)),['research']);
  assert.deepEqual(ids(pick({purpose:'hsjob',careerIds:['nurse']},teachers)),['welfare']);
  assert.deepEqual(ids(pick({careerIds:['coder']},teachers)),['ux']);
  assert.deepEqual(ids(pick({uni:{uni:'架空芸術大学'}},teachers)),[]);
  assert.deepEqual(ids(pick({freeTopics:'未知の関心分野'},teachers)),[]);
  assert.deepEqual(ids(pick({purpose:'hsjob',uni:{dep:'舞台芸術学科'}},teachers)),[]);
});

test('進学指導の明示登録だけを根拠にし、通常候補や対象外の目的を除外する',()=>{
  const guidance={uni:'架空大学',fac:'芸術学部',kind:'admissions',source:'successfulGuidance'};
  const query={uni:{dep:'演劇学科'}};
  const teachers=[
    teacher('guided',{support:[guidance]}),
    teacher('direct',{support:[guidance],topicIds:['film']}),
    teacher('experienceOnly',{academic:[{major:'演劇学科'}],support:[{...guidance,source:'attendance'}]}),
    teacher('notes',{intro:'演劇学科と映像制作'}),
    teacher('wrongGoal',{support:[guidance],purposes:['hsjob']})
  ];
  const results=pick(query,teachers,['direct']);
  assert.deepEqual(ids(results),['guided']);
  assert.equal(results[0].reasons[0].evidence.record,guidance);
  assert.equal(results[0].reasons[0].query.ja,'演劇学科');
});

test('候補は同じ先生を一度だけ紹介し、最大4名まで',()=>{
  const teachers=['5','3','1','2','4'].map(id=>teacher(id,{topicIds:['film'],freeTopics:'映像制作、脚本'}));
  teachers.push(teacher('1',{topicIds:['film']}));
  assert.deepEqual(ids(pick({uni:{dep:'演劇学科'},freeTopics:'演技'},teachers)),['1','2','3','4']);
});
