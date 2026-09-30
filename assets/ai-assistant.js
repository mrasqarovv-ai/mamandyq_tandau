(() => {
  'use strict';
  const CFG = window.MAMANDYQ_CONFIG || {};
  const HISTORY_KEY = 'mamandyq_ai_history_v1';
  const CLIENT_KEY = 'mamandyq_ai_client_v1';
  const SHARE_KEY = 'mamandyq_ai_share_profile';
  const MAX_SAVED = 20;
  const COPY = {
    kk:{name:'Бағыт AI', status:'Мамандық және оқу бағыты бойынша AI кеңесші', online:'Интернеттен өзекті дерек іздей алады', placeholder:'Сұрағыңызды жазыңыз…', send:'Жіберу', clear:'Чатты тазалау', close:'Жабу', share:'Профильдің қысқаша контекстін AI-ға беру', privacy:'ЖСН, толық мекенжай, пароль сияқты құпия деректерді жібермеңіз.', hello:'Сәлем! Мен Бағыт AI кеңесшісімін. Мамандық, B-топ, ҰБТ, ЖОО және оқу маршруты туралы сұрай аласыз. Өзекті ақпарат керек болса, интернеттен тексеремін.', thinking:'Жауап дайындап жатырмын…', setup:'AI сервер адресі әлі бапталмаған. config.js файлындағы AI_API_URL мәнін Cloudflare Worker адресіне ауыстырыңыз.', error:'Қазір AI серверіне қосыла алмадым. Біраздан соң қайталап көріңіз.', rate:'Сұраныс тым жиі жіберілді. Бір минуттан кейін қайта көріңіз.', sources:'Дереккөздер', quick:['Маған қандай мамандық сәйкес?','B057 туралы түсіндір','ҰБТ баллымды қалай бағалауға болады?','Қазіргі ЖОО ақпаратын интернеттен тексер']},
    ru:{name:'Бағыт AI', status:'AI-консультант по профессиям и обучению', online:'Может искать актуальные данные в интернете', placeholder:'Напишите вопрос…', send:'Отправить', clear:'Очистить чат', close:'Закрыть', share:'Передавать AI краткий контекст профиля', privacy:'Не отправляйте ИИН, полный адрес, пароли и другие секретные данные.', hello:'Привет! Я консультант Бағыт AI. Спросите о профессии, B-группе, ЕНТ, вузе или образовательном маршруте. Если нужны свежие данные, я проверю интернет.', thinking:'Готовлю ответ…', setup:'Адрес AI-сервера ещё не настроен. Замените AI_API_URL в config.js на адрес Cloudflare Worker.', error:'Не удалось подключиться к AI-серверу. Попробуйте позже.', rate:'Слишком много запросов. Попробуйте снова через минуту.', sources:'Источники', quick:['Какая профессия мне подходит?','Объясни B057','Как оценить мой балл ЕНТ?','Проверь актуальную информацию о вузе']},
    en:{name:'Baǵyt AI', status:'AI adviser for careers and education', online:'Can search the web for current information', placeholder:'Ask a question…', send:'Send', clear:'Clear chat', close:'Close', share:'Share a short profile context with AI', privacy:'Do not send national IDs, full addresses, passwords, or other secrets.', hello:'Hi! I am Baǵyt AI. Ask about careers, B-groups, UNT, universities, or study routes. When information may have changed, I can check the web.', thinking:'Preparing an answer…', setup:'The AI server URL is not configured yet. Replace AI_API_URL in config.js with your Cloudflare Worker URL.', error:'I could not reach the AI server. Please try again later.', rate:'Too many requests. Please try again in a minute.', sources:'Sources', quick:['Which careers fit me?','Explain B057','How should I interpret my UNT score?','Check current university information']}
  };
  function lang(){ try{return (typeof app!=='undefined' && app.lang) || localStorage.getItem('cn6_lang') || 'kk'}catch(_){return 'kk'} }
  function tr(){ return COPY[lang()] || COPY.kk }
  function apiUrl(){ return String(CFG.AI_API_URL || '').trim(); }
  function configured(){ const u=apiUrl(); return /^https:\/\//i.test(u) && !u.includes('REPLACE-WITH'); }
  function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function formatText(s){ let x=escapeHtml(s); x=x.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>'); x=x.replace(/(^|\n)[•*-]\s+([^\n]+)/g,'$1• $2'); x=x.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); return x; }
  function getClientId(){ let id=localStorage.getItem(CLIENT_KEY); if(!id){ id=(crypto.randomUUID?crypto.randomUUID():('c_'+Date.now()+'_'+Math.random().toString(36).slice(2))); localStorage.setItem(CLIENT_KEY,id); } return id; }
  function loadHistory(){ try{const x=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');return Array.isArray(x)?x.slice(-MAX_SAVED):[]}catch(_){return[]} }
  function saveHistory(h){ localStorage.setItem(HISTORY_KEY,JSON.stringify(h.slice(-MAX_SAVED))); }
  function currentLangName(o){ const l=lang(); return o?.[l] ?? o?.kk ?? o?.ru ?? o?.en ?? ''; }
  function clusterLabel(k){ try{ if(typeof CLUSTERS!=='undefined'){ const c=CLUSTERS.find(x=>x[0]===k); if(c) return c[lang()==='kk'?1:lang()==='ru'?2:3]; } }catch(_){} return k; }
  function pairLabel(k){ try{ if(typeof PAIRS!=='undefined' && PAIRS[k]) return currentLangName(PAIRS[k]); }catch(_){} return k||''; }
  function getProfiles(){ try{return JSON.parse(localStorage.getItem('cn6_profiles')||'{}')}catch(_){return{}} }
  function getProfileSummary(){
    if(localStorage.getItem(SHARE_KEY)==='0') return null;
    const ps=getProfiles(); let role=null; try{role=(typeof app!=='undefined'&&app.role)||null}catch(_){}
    const entry=(role&&ps[role]) || ps.student || ps.parent; const p=entry?.profile; if(!p) return null;
    const summary={role:p.role||role||'',grade:p.grade||'',profile_pair:pairLabel(p.pair),unt_score:p.score||null,preferred_city:p.preferredCity||'',after_grade9:p.after9||'',values:(p.values||[]).slice(0,5),abilities:p.abilities||{}};
    summary.top_interests=Object.entries(p.interests||{}).filter(x=>Number.isFinite(x[1])).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>({area:clusterLabel(k),score:v}));
    try{ if(typeof PROFS!=='undefined') summary.top_careers=(p.professions||[]).slice(0,5).map(r=>{const pr=PROFS.find(x=>x.id===r.id);return pr?{career:currentLangName(pr.name),match_index:r.score,bcodes:(pr.bcodes||[]).slice(0,5)}:null}).filter(Boolean); }catch(_){}
    return summary;
  }
  function tokens(q){ return String(q||'').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=3).slice(0,20); }
  function nameOfProgram(p){ const l=lang(); return p?.['name_'+l] || p?.name_kk || ''; }
  function scoreText(txt, toks){ const s=String(txt||'').toLocaleLowerCase(); return toks.reduce((n,t)=>n+(s.includes(t)?1:0),0); }
  function relevantCatalog(question, profile){
    const q=String(question||''); const toks=tokens(q); const upper=q.toUpperCase(); const exact=[...new Set((upper.match(/\b(?:BM|B)\d{3}\b/g)||[]))];
    const result={data_year:'2026–2027',grant_scope:'ЖАЛПЫ КОНКУРС / GENERAL COMPETITION; historical comparison, not admission probability'};
    try{ if(typeof PROGRAMS!=='undefined'){
      const preferredCodes=new Set(exact); (profile?.top_careers||[]).slice(0,3).forEach(c=>(c.bcodes||[]).forEach(x=>preferredCodes.add(x)));
      let ranked=PROGRAMS.map(p=>({p,s:(preferredCodes.has(p.code)?10:0)+scoreText(p.code+' '+nameOfProgram(p),toks)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,6).map(x=>x.p);
      result.programs=ranked.map(p=>({code:p.code,name:nameOfProgram(p),profile_pairs:(p.pairs||[]).map(pairLabel),historical:p.hist?{min:p.hist.min,q25:p.hist.q25,median:p.hist.median,q75:p.hist.q75,max:p.hist.max,count:p.hist.count,universities:(p.hist.universities||[]).slice(0,6).map(u=>({code:u.code,name:u.name,city:u.city||'',min:u.min,median:u.median,q75:u.q75,count:u.count}))}:null}));
    }}catch(_){}
    try{ if(typeof UNIS!=='undefined'){
      const ranked=UNIS.map(u=>({u,s:scoreText([u.name,u.city,u.programs,u.address].join(' '),toks)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,5).map(x=>x.u);
      result.universities=ranked.map(u=>({name:u.name,city:u.city,address:u.address,phone:u.phone,programs:u.programs,dorm:u.dorm,grant:u.grant}));
    }}catch(_){}
    try{ if(typeof PROFS!=='undefined'){
      const ranked=PROFS.map(p=>({p,s:scoreText([currentLangName(p.name),currentLangName(p.desc),...(p.bcodes||[])].join(' '),toks)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,5).map(x=>x.p);
      result.careers=ranked.map(p=>({name:currentLangName(p.name),description:currentLangName(p.desc),bcodes:p.bcodes||[]}));
    }}catch(_){}
    return result;
  }
  function buildContext(question){ const profile=getProfileSummary(); let section='';try{section=(typeof app!=='undefined'&&app.section)||''}catch(_){} return {site:'Бағыт · Career Navigator',site_version:'v12 AI',language:lang(),current_section:section,profile,local_catalog:relevantCatalog(question,profile)}; }
  const root=document.createElement('div');
  root.innerHTML=`<button class="ai-fab" id="aiFab" type="button" aria-label="AI"><span class="ai-fab-dot"></span><span id="aiFabLabel">Бағыт AI</span></button><div class="ai-backdrop" id="aiBackdrop"></div><aside class="ai-panel" id="aiPanel" role="dialog" aria-modal="true" aria-labelledby="aiTitle"><div class="ai-head"><div class="ai-orb">✦</div><div class="ai-head-copy"><b id="aiTitle">Бағыт AI</b><small id="aiSubtitle"></small></div><button class="ai-icon-btn" id="aiClear" type="button" title="Clear">↺</button><button class="ai-icon-btn" id="aiClose" type="button" title="Close">×</button></div><div class="ai-status" id="aiStatus"></div><div class="ai-messages" id="aiMessages" aria-live="polite"></div><div class="ai-quick" id="aiQuick"></div><label class="ai-privacy"><input id="aiShare" type="checkbox"><span id="aiShareLabel"></span></label><div class="ai-privacy" id="aiPrivacy"></div><div class="ai-compose"><textarea class="ai-input" id="aiInput" rows="1" maxlength="3000"></textarea><button class="ai-send" id="aiSend" type="button" aria-label="Send">➤</button></div></aside>`;
  document.body.appendChild(root);
  const el=id=>document.getElementById(id); let history=loadHistory(); let busy=false;
  function updateStrings(){ const c=tr(); el('aiFabLabel').textContent=c.name; el('aiTitle').textContent=c.name; el('aiSubtitle').textContent=c.status; el('aiStatus').innerHTML=`<strong>●</strong> ${escapeHtml(c.online)}`; el('aiInput').placeholder=c.placeholder; el('aiShareLabel').textContent=c.share; el('aiPrivacy').textContent=c.privacy; el('aiClose').title=c.close; el('aiClear').title=c.clear; el('aiQuick').innerHTML=''; c.quick.forEach(q=>{const b=document.createElement('button');b.type='button';b.className='ai-chip';b.textContent=q;b.onclick=()=>{el('aiInput').value=q;send()};el('aiQuick').appendChild(b)}); renderHistory(); }
  function openPanel(v=true){el('aiPanel').classList.toggle('on',v);el('aiBackdrop').classList.toggle('on',v);if(v)setTimeout(()=>el('aiInput').focus(),180)}
  function renderSources(container,sources){ if(!Array.isArray(sources)||!sources.length)return; const box=document.createElement('div');box.className='ai-sources'; const cap=document.createElement('strong');cap.textContent=tr().sources;cap.style.fontSize='.78rem';box.appendChild(cap); sources.slice(0,6).forEach(s=>{try{const a=document.createElement('a');a.className='ai-source';a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';const icon=document.createElement('span');icon.textContent='↗';const title=document.createElement('span');title.className='ai-source-title';title.textContent=s.title||new URL(s.url).hostname;a.append(icon,title);box.appendChild(a)}catch(_){}});container.appendChild(box); }
  function addMessage(m){ const row=document.createElement('div');row.className='ai-msg '+(m.role==='user'?'user':'assistant');const b=document.createElement('div');b.className='ai-bubble';b.innerHTML=formatText(m.content||'');renderSources(b,m.sources);row.appendChild(b);el('aiMessages').appendChild(row); }
  function renderHistory(){ const box=el('aiMessages');box.innerHTML=''; if(!history.length)addMessage({role:'assistant',content:tr().hello}); else history.forEach(addMessage); box.scrollTop=box.scrollHeight; }
  function setThinking(v){ const old=el('aiThinking');if(old)old.remove();if(v){const d=document.createElement('div');d.id='aiThinking';d.className='ai-thinking';d.innerHTML=`<i></i><i></i><i></i><span>${escapeHtml(tr().thinking)}</span>`;el('aiMessages').appendChild(d);el('aiMessages').scrollTop=el('aiMessages').scrollHeight;} }
  async function send(){
    if(busy)return; const input=el('aiInput');const text=input.value.trim();if(!text)return;
    if(!configured()){history.push({role:'user',content:text},{role:'assistant',content:tr().setup});saveHistory(history);input.value='';renderHistory();return;}
    history.push({role:'user',content:text}); history=history.slice(-MAX_SAVED);saveHistory(history);input.value='';renderHistory();busy=true;el('aiSend').disabled=true;setThinking(true);
    try{
      const payload={language:lang(),messages:history.filter(x=>x.role==='user'||x.role==='assistant').slice(-9).map(x=>({role:x.role,content:x.content})),context:buildContext(text)};
      const res=await fetch(apiUrl(),{method:'POST',headers:{'Content-Type':'application/json','X-Client-Id':getClientId()},body:JSON.stringify(payload)}); let data={};try{data=await res.json()}catch(_){}
      if(res.status===429)throw new Error('RATE'); if(!res.ok)throw new Error(data?.error||('HTTP '+res.status));
      history.push({role:'assistant',content:data.answer||tr().error,sources:Array.isArray(data.sources)?data.sources:[],searched:!!data.searched});history=history.slice(-MAX_SAVED);saveHistory(history);
    }catch(err){history.push({role:'assistant',content:err?.message==='RATE'?tr().rate:tr().error});history=history.slice(-MAX_SAVED);saveHistory(history)}
    finally{busy=false;el('aiSend').disabled=false;setThinking(false);renderHistory()}
  }
  el('aiFab').onclick=()=>openPanel(true);el('aiClose').onclick=()=>openPanel(false);el('aiBackdrop').onclick=()=>openPanel(false);el('aiClear').onclick=()=>{history=[];saveHistory(history);renderHistory()};el('aiSend').onclick=send;
  el('aiShare').checked=localStorage.getItem(SHARE_KEY)!=='0';el('aiShare').onchange=e=>localStorage.setItem(SHARE_KEY,e.target.checked?'1':'0');
  el('aiInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}); document.addEventListener('keydown',e=>{if(e.key==='Escape')openPanel(false)});
  const langSel=document.getElementById('langSel');if(langSel)langSel.addEventListener('change',()=>setTimeout(updateStrings,0)); updateStrings();
})();
