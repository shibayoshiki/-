'use strict';

const Matching = (() => {
 const fields = ['uni', 'fac', 'dep'];
 const placeWeights = {uni:46, fac:25, dep:29};
 const conflicts = {fac:16, dep:18};
 const partialRate = 0.4;
 const universityWideBonus = 8;
 const minimumNameLength = 3;
 const maxInputLines = 20;
 const suffixes = {uni:['大学'], fac:['学部','学群'], dep:['学科','専攻']};
 // Add only verified, unambiguous aliases. Catalog entries already supply Japanese and English labels.
 const aliases = {uni:{}, fac:{}, dep:{}};
 const policies = {
  university: {
   topic:17, qualification:10, career:12, freeTopic:12, freeCareer:10,
   practice:7, careerExperience:5, topicCap:45, careerCap:32,
   kinds:{admissions:12, study:2, career:0, general:2},
   sources:{successfulGuidance:16, application:10, careerGuidance:8, universityKnowledge:10,
    attendance:3, guidance:8, personal:4, academic:6, research:7}
  },
  campus: {
   topic:17, qualification:10, career:12, freeTopic:12, freeCareer:10,
   practice:7, careerExperience:5, topicCap:45, careerCap:32,
   kinds:{admissions:0, study:12, career:0, general:2},
   sources:{attendance:18, universityKnowledge:12, academic:8, personal:5, research:6,
    careerGuidance:3, guidance:3}
  },
  hsjob: {topic:17, qualification:18, career:32, freeTopic:12, freeCareer:14,
   practice:16, careerExperience:19, topicCap:56, careerCap:68},
  gradjob: {topic:20, qualification:14, career:30, freeTopic:14, freeCareer:16,
   practice:18, careerExperience:18, topicCap:60, careerCap:65,
   kinds:{admissions:0, study:4, career:14, general:3},
   sources:{careerGuidance:13, academic:10, universityKnowledge:8, research:7,
    attendance:5, guidance:6, personal:3, successfulGuidance:2}}
 };

 const placeKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s/gu,'');
 const labelKey = value => placeKey(value).replace(/[·・\-－()（）]/gu,'');
 const lines = value => String(value || '').split(/[\n,、，]+/u).map(line=>line.trim()).filter(Boolean).slice(0,maxInputLines);
 function classify(field, query, registered){
  const target=placeKey(query), saved=placeKey(registered);
  if(!target)return 'unspecified';
  if(!saved)return 'unregistered';
  const canonical=key=>Object.hasOwn(aliases[field],key)?aliases[field][key]:key;
  if(canonical(target)===canonical(saved))return 'exact';
  // Omission of a generic suffix can be a clue. Different explicit suffixes are never equivalent.
  const shorter=target.length<saved.length?target:saved;
  const longer=shorter===target?saved:target;
  const endings=suffixes[field];
  if([...shorter].length>=minimumNameLength&&!endings.some(suffix=>shorter.endsWith(suffix))&&
   endings.some(suffix=>longer===shorter+suffix))return 'partial';
  return 'different';
 }

 function evaluatePlace(query, record, policy){
  const states=Object.fromEntries(fields.map(field=>[field,classify(field,query[field],record?.[field])]));
  const all=fields.every(field=>['unspecified','exact'].includes(states[field]));
  const wide=record?.scope==='university'&&states.uni==='exact'&&!record.fac&&!record.dep;
  const universityConflict=states.uni==='different';
  let location=0;
  if(!universityConflict){
   for(const field of fields){
    if(field==='dep'&&states.fac==='different'&&states.dep!=='different')continue;
    if(states[field]==='exact')location+=placeWeights[field];
    if(states[field]==='partial')location+=Math.round(placeWeights[field]*partialRate);
   }
  }
  const compatible=location>0&&!fields.some(field=>['different','partial'].includes(states[field]));
  // Evidence is an explicit claim about the selected record, never inferred from another row.
  const kindPoints=compatible?(policy.kinds?.[record?.kind]||0):0;
  const sourcePoints=kindPoints>0?(policy.sources?.[record.source]||0):0;
  const penalty=location>0?Object.keys(conflicts).reduce((sum,field)=>sum+(states[field]==='different'?conflicts[field]:0),0):0;
  const score=Math.max(0,location-penalty+kindPoints+sourcePoints+(wide?universityWideBonus:0));
  return {record,states,all,wide,score,location,kindPoints,sourcePoints};
 }

 function bestPlace(query, records, policy){
  if(!fields.some(field=>placeKey(query[field])))return evaluatePlace({},null,policy);
  // A zero-score record may still explain why the university criteria did not match.
  const candidates=(records.length?records:[null]).map(record=>evaluatePlace(query,record,policy));
  candidates.sort((a,b)=>b.score-a.score||b.location-a.location||Number(b.all)-Number(a.all));
  return candidates[0];
 }

 function catalogIndex(items){
  const names=new Map(), catalog=new Map(items.map(item=>[item.id,item]));
  for(const item of items)for(const label of [item.ja,item.en]){
   const key=labelKey(label);
   if(!key)continue;
   if(names.has(key)&&names.get(key)!==item.id)names.set(key,null);
   else names.set(key,item.id);
  }
  return {names,catalog};
 }

 function entries(ids, free, index){
  const values=new Map();
  for(const id of ids||[])if(index.catalog.has(id))values.set(id,{id});
  for(const label of lines(free)){
   const normalized=labelKey(label);
   if(!normalized)continue;
   const id=index.names.get(normalized);
   const key=id||'text:'+normalized;
   if(!values.has(key))values.set(key,{id,label});
  }
  return values;
 }

 function matches(query, registered, index, experienceIds, weight){
  const experience=new Set(experienceIds||[]);
  const matched=[];
  for(const [key,item] of query){
   const registration=registered.get(key);
   if(!registration)continue;
   const catalogItem=index.catalog.get(item.id);
   const qualification=catalogItem?.kind==='qualification';
   const practical=!!item.id&&!registration.label&&!qualification&&experience.has(item.id);
   const points=weight({catalogItem,qualification,practical});
   matched.push({...item,qualification,practical,points});
  }
  return matched;
 }

 function rank(student, teachers, topics, careers){
  const topicIndex=catalogIndex(topics), careerIndex=catalogIndex(careers);
  const queryTopics=entries(student.topicIds,student.freeTopics,topicIndex);
  const queryCareers=entries(student.careerIds,student.freeCareers,careerIndex);
  const policy=policies[student.purpose==='university'&&student.universityIntent==='campus'?'campus':student.purpose];
  if(!policy)return [];
  const placedQuery=student.purpose==='hsjob'?{}:(student.uni||{});
  const results=[];
  for(const teacher of teachers){
   if(!teacher.purposes?.includes(student.purpose))continue;
   const uni=bestPlace(placedQuery,teacher.support||[],policy);
   const topicMatches=matches(queryTopics,entries(teacher.topicIds,teacher.freeTopics,topicIndex),
    topicIndex,teacher.practiceTopicIds,({catalogItem,qualification,practical})=>
     (qualification?policy.qualification:catalogItem?policy.topic:policy.freeTopic)+(practical?policy.practice:0));
   const careerMatches=matches(queryCareers,entries(teacher.careerIds,teacher.freeCareers,careerIndex),
    careerIndex,teacher.experiencedCareerIds,({catalogItem,practical})=>
     (catalogItem?policy.career:policy.freeCareer)+(practical?policy.careerExperience:0));
   const total=items=>items.reduce((sum,item)=>sum+item.points,0);
   const score=uni.score+Math.min(policy.topicCap,total(topicMatches))+Math.min(policy.careerCap,total(careerMatches));
   if(score>0)results.push({teacher,score,uni,topicMatches,careerMatches,
    freeTopics:topicMatches.filter(item=>item.label).map(item=>item.label),
    freeCareers:careerMatches.filter(item=>item.label).map(item=>item.label)});
  }
  return results.sort((a,b)=>b.score-a.score||String(a.teacher.id||'').localeCompare(String(b.teacher.id||''),'en'));
 }
 return {rank};
})();
