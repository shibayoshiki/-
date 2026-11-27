'use strict';

const RelatedTeachers = (() => {
 // Each rule links the student's interest (from) to a separately registered area (to).
 // Faculty and department targets require an explicit admissions guidance record.
 const rules = [
  {
   from:{fac:['芸術学部','芸術文化学群','Faculty of Arts'],dep:['演劇学科','舞台芸術学科','演劇専攻','Theatre'],topic:['演技','Acting','舞台演出','Theatre direction'],career:['俳優','Actor','舞台演出家','Theatre director']},
   to:{topic:['映像制作','Film production','映像編集','Film editing','脚本','Screenwriting'],career:['映像制作','Film producer']},
   why:['映像表現や脚本の視点から、演技や作品づくりを考える手がかりになります。','Film and scriptwriting offer additional ways to think about acting and making a production.']
  },
  {
   from:{dep:['演劇学科','舞台芸術学科','演劇専攻','Theatre'],topic:['演技','Acting','舞台演出','Theatre direction'],career:['俳優','Actor']},
   to:{topic:['日本文学','Japanese literature','世界文学','World literature','社会心理学','Social psychology']},
   why:['作品の解釈や登場人物の関係を、別の分野の視点から考える手がかりになります。','Literature and social psychology offer perspectives on interpreting works and relationships between characters.']
  },
  {
   from:{dep:['演劇学科','舞台芸術学科','演劇専攻','Theatre'],topic:['演技','Acting','舞台演出','Theatre direction'],career:['俳優','Actor']},
   to:{fac:['芸術学部','芸術文化学群','Faculty of Arts'],dep:['演劇学科','舞台芸術学科','Theatre']},
   why:['芸術系の進学先や入試を比較する際に役立つ可能性があります。','Guidance in arts admissions may help you compare programs and application routes.']
  },
  {
   from:{fac:['情報学部','情報科学部','Faculty of Informatics'],dep:['情報科学科','データサイエンス学科','Computer Science','Data Science'],topic:['データサイエンス','Data science','機械学習','Machine learning'],career:['データサイエンティスト','Data scientist']},
   to:{topic:['統計学','Statistics','計量経済学','Econometrics'],dep:['統計学科','データサイエンス学科','Statistics']},
   why:['データの集め方や分析結果の読み取りを、統計・実証分析の視点から考えられます。','Statistics and empirical analysis provide perspectives on collecting data and interpreting results.']
  },
  {
   from:{dep:['情報工学科','Computer Engineering'],topic:['プログラミング','Programming','Webアプリ開発','Web application development'],career:['プログラマー','Software engineer']},
   to:{topic:['UXデザイン','UX design','情報デザイン','Information design'],career:['UXデザイナー','UX designer']},
   why:['使う人の視点から、アプリの画面や情報の伝え方を考える手がかりになります。','Design provides a way to consider app interfaces and communication from a user’s perspective.']
  },
  {
   from:{fac:['看護学部','Faculty of Nursing'],dep:['看護学科','Nursing'],topic:['看護学','Nursing'],career:['看護師','Nurse']},
   to:{topic:['公衆衛生学','Public health','社会福祉学','Social welfare'],career:['社会福祉士','Social worker'],dep:['保健学科','公衆衛生学科','Public Health']},
   why:['地域での健康支援や福祉との連携について知る手がかりになります。','Public health and social work offer perspectives on community health and collaboration with care services.']
  },
  {
   from:{fac:['デザイン学部','Faculty of Design'],dep:['建築学科','インテリアデザイン学科','Architecture','Interior Design'],topic:['インテリアデザイン','Interior design','建築設計','Architectural design'],career:['インテリアデザイナー','Interior designer','建築士','Architect']},
   to:{topic:['空間デザイン','Spatial design','住居学','Housing studies','ユニバーサルデザイン','Universal design'],dep:['住居学科','建築学科','Architecture']},
   why:['空間の使い方や暮らしやすさを、住居・利用者の視点から考える手がかりになります。','These areas offer perspectives on how spaces are used and made accessible.']
  },
  {
   from:{fac:['経済学部','Faculty of Economics'],dep:['経済学科','Economics'],topic:['ミクロ経済学','Microeconomics','行動経済学','Behavioral economics'],career:['金融アナリスト','Financial analyst']},
   to:{topic:['統計学','Statistics','会計学','Accounting','社会心理学','Social psychology'],career:['公認会計士','Certified public accountant']},
   why:['数字や人の意思決定を、統計・会計・心理の視点から考える手がかりになります。','Statistics, accounting and psychology offer additional perspectives on data and human decisions.']
  }
 ];
 const guidanceSources=new Set(['guidance','successfulGuidance','careerGuidance']);
 const maxTeachers=4;
 const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s/gu,'');
 const freeLines=value=>String(value||'').split(/[\n,、，]+/u).map(line=>line.trim()).filter(Boolean);
 const token=(type,ja,en=ja,record=null)=>({type,ja,en,record});
 function catalogTokens(type,ids,free,catalog){
  const selected=new Set(ids||[]);
  const tokens=catalog.filter(item=>selected.has(item.id)&&item.kind!=='qualification')
   .map(item=>token(type,item.ja,item.en||item.ja));
  for(const term of freeLines(free)){
   // Recognize the two registered labels of a uniquely identified catalog item.
   const named=catalog.filter(item=>[item.ja,item.en].some(label=>key(label)===key(term)));
   if(named.length===1&&named[0].kind==='qualification')continue;
   const item=named.length===1?named[0]:null;
   tokens.push(item?token(type,item.ja,item.en||item.ja):token(type,term));
  }
  return tokens;
 }
 function profileTokens(profile,topics,careers){
  return [...catalogTokens('topic',profile.topicIds,profile.freeTopics,topics),
   ...catalogTokens('career',profile.careerIds,profile.freeCareers,careers)];
 }
 const compiled=rules.map(rule=>({
  from:Object.fromEntries(Object.entries(rule.from).map(([type,labels])=>[type,new Set(labels.map(key))])),
  to:Object.fromEntries(Object.entries(rule.to).map(([type,labels])=>[type,new Set(labels.map(key))])),
  why:rule.why
 }));
 const matches=(sides,item)=>[item.ja,item.en].some(label=>sides[item.type]?.has(key(label)));

 function pick(student,teachers,topics,careers,directIds){
  const queries=profileTokens(student,topics,careers);
  if(student.purpose!=='hsjob'){
   for(const type of ['dep','fac'])if(student.uni?.[type])queries.push(token(type,student.uni[type]));
  }
  const active=compiled.flatMap(rule=>{
   const query=queries.find(item=>matches(rule.from,item));
   return query?[{rule,query}]:[];
  });
  if(!active.length)return [];

  const excluded=new Set(directIds);
  const results=[];
  for(const teacher of teachers){
   if(excluded.has(teacher.id)||!teacher.purposes?.includes(student.purpose))continue;
   const registered=profileTokens(teacher,topics,careers);
   if(student.purpose!=='hsjob'){
    for(const entry of teacher.support||[]){
     if(entry.kind!=='admissions'||!guidanceSources.has(entry.source))continue;
     for(const type of ['dep','fac'])if(entry[type])registered.push(token(type,entry[type],entry[type],entry));
    }
   }
   const reasons=[];
   for(const {rule,query} of active){
    const evidence=registered.find(item=>matches(rule.to,item));
    if(evidence)reasons.push({query,evidence,why:rule.why});
   }
   if(reasons.length){
    results.push({teacher,reasons});
    excluded.add(teacher.id);
   }
  }
  return results.sort((a,b)=>String(a.teacher.id).localeCompare(String(b.teacher.id),'en')).slice(0,maxTeachers);
 }
 return {pick};
})();
