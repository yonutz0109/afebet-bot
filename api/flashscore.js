const DEFAULT_TIMEOUT_MS = 3500;
const flashCache = new Map();

function normalizeName(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cacheGet(key){
  const hit = flashCache.get(key);
  if(!hit) return null;
  if(Date.now() - hit.ts > 1000 * 60 * 10){
    flashCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key,value){
  flashCache.set(key,{ts:Date.now(),value});
  return value;
}

async function fetchJsonWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const r = await fetch(url,{cache:"no-store",signal:controller.signal,headers:{"accept":"application/json"}});
    if(!r.ok) return {ok:false,status:r.status,data:null};
    const data = await r.json().catch(()=>null);
    return {ok:true,status:r.status,data};
  }catch(e){
    return {ok:false,status:0,data:null,error:e?.name || "fetch_error"};
  }finally{
    clearTimeout(timer);
  }
}

function pickArray(data){
  if(Array.isArray(data)) return data;
  if(Array.isArray(data?.events)) return data.events;
  if(Array.isArray(data?.matches)) return data.matches;
  if(Array.isArray(data?.response)) return data.response;
  if(Array.isArray(data?.data)) return data.data;
  return [];
}

function extractTeamNames(row){
  const home = row?.home?.name || row?.homeTeam?.name || row?.home_team || row?.homeName || row?.teams?.home?.name || "";
  const away = row?.away?.name || row?.awayTeam?.name || row?.away_team || row?.awayName || row?.teams?.away?.name || "";
  return {home,away};
}

function findBestMatch(data, home, away){
  const rows = pickArray(data);
  const nh = normalizeName(home), na = normalizeName(away);
  return rows.find(row=>{
    const t = extractTeamNames(row);
    const rh = normalizeName(t.home), ra = normalizeName(t.away);
    return (rh.includes(nh) || nh.includes(rh)) && (ra.includes(na) || na.includes(ra));
  }) || rows[0] || null;
}

function parseForm(value){
  if(Array.isArray(value)) return value.join("").toUpperCase().replace(/[^WDL]/g,"").slice(0,5);
  return String(value || "").toUpperCase().replace(/[^WDL]/g,"").slice(0,5);
}

function points(form){
  return [...String(form||"")].reduce((s,x)=>s+(x==="W"?3:x==="D"?1:0),0);
}

function extractContext(row){
  if(!row) return {available:false,boost:0,note:"Flashscore nu a găsit meciul."};
  const homeForm = parseForm(row?.homeForm || row?.form?.home || row?.home?.form || row?.teams?.home?.form);
  const awayForm = parseForm(row?.awayForm || row?.form?.away || row?.away?.form || row?.teams?.away?.form);
  const h2hCount = Number(row?.h2hCount ?? row?.h2h?.length ?? row?.headToHead?.length ?? 0) || 0;
  const injuries = Number(row?.injuriesCount ?? row?.injuries?.length ?? 0) || 0;
  const hasLineups = Boolean(row?.lineups || row?.homeLineup || row?.awayLineup);
  const liveMinute = Number(row?.minute ?? row?.status?.elapsed ?? row?.fixture?.status?.elapsed ?? 0) || 0;

  let boost = 0;
  if(homeForm && awayForm){
    const diff = Math.abs(points(homeForm)-points(awayForm));
    if(diff >= 7) boost += 3;
    else if(diff >= 4) boost += 2;
    else if(diff >= 2) boost += 1;
  }
  if(h2hCount >= 3) boost += 1;
  if(hasLineups) boost += 1;
  if(liveMinute > 0) boost += 2;
  if(injuries >= 4) boost -= 1;
  boost = Math.max(-2, Math.min(5, boost));

  const parts = [];
  if(homeForm || awayForm) parts.push(`formă Flashscore ${homeForm||"n/a"} vs ${awayForm||"n/a"}`);
  if(h2hCount) parts.push(`H2H ${h2hCount}`);
  if(hasLineups) parts.push("lineup disponibil");
  if(liveMinute) parts.push(`live ${liveMinute}'`);
  if(injuries) parts.push(`accidentări/absențe ${injuries}`);

  return {available:true,boost,homeForm:homeForm||"n/a",awayForm:awayForm||"n/a",h2hCount,hasLineups,liveMinute,injuries,note:parts.length?`Context Flashscore: ${parts.join(", ")}. Bonus: ${boost>=0?"+":""}${boost}.`:"Context Flashscore disponibil. Bonus 0."};
}

async function getFlashscoreContext(home, away){
  const base = process.env.FLASHSCORE_API_URL;
  if(!base) return {available:false,boost:0,note:"FLASHSCORE_API_URL lipsește. Flashscore este dezactivat, botul folosește Odds API + API-FOOTBALL."};
  const key = `${home}|${away}`;
  const cached = cacheGet(key);
  if(cached) return cached;

  try{
    const url = new URL(base);
    url.searchParams.set("home", home);
    url.searchParams.set("away", away);
    const pack = await fetchJsonWithTimeout(url.toString());
    if(!pack.ok) return cacheSet(key,{available:false,boost:0,note:`Flashscore nu a răspuns corect (${pack.status || "timeout"}). Continui fără el.`});
    const row = findBestMatch(pack.data,home,away);
    return cacheSet(key,extractContext(row));
  }catch(e){
    return cacheSet(key,{available:false,boost:0,note:"Flashscore nu a putut fi citit. Continui fără el."});
  }
}

export { getFlashscoreContext };
