const ODDS_BASE="https://api.the-odds-api.com/v4";
const FOOTBALL_API="https://v3.football.api-sports.io";
const MIN_SAFE_SCORE=75;
const MARKETS=["h2h","totals","spreads"];
const MAX_SPORTS_TO_SCAN=14;

function marketLabel(k){return({h2h:"1X2",totals:"Goluri over/under",spreads:"Handicap"}[k]||k||"necunoscută")}
function category(k){if(k==="h2h")return"h2h";if((k||"").includes("total"))return"totals";if((k||"").includes("spread"))return"spreads";return"other"}
function baseScore(odd,market){let s=Math.round((1/Number(odd))*100);if(market==="h2h")s-=4;if((market||"").includes("total"))s-=1;if((market||"").includes("spread"))s-=3;if(odd>=1.12&&odd<=1.45)s+=8;if(odd>1.65)s-=20;if(odd>1.90)s-=30;return Math.max(0,Math.min(95,s))}
function pickLabel(outcome,market,home,away){let n=outcome?.name||"";let p=outcome?.point!=null?` ${outcome.point}`:"";if(market==="h2h"){if(n===home)return"1 - câștigă gazdele";if(n===away)return"2 - câștigă oaspeții";if(n==="Draw")return"X - egal"}if((market||"").includes("total"))return `${n}${p} goluri`;if((market||"").includes("spread"))return `${n} handicap ${p}`;return `${n}${p}`.trim()||"Selecție necunoscută"}
function roDate(iso){return iso?new Date(iso).toLocaleString("ro-RO",{timeZone:"Europe/Bucharest"}):""}
function addTop(list,c){list.push(c);list.sort((a,b)=>(b.safeScore||0)-(a.safeScore||0));if(list.length>5)list.pop()}
function clean(c){if(!c)return c;const x={...c};delete x.rawScore;return x}

function timeInfo(iso){
 const start=iso?new Date(iso).getTime():0;
 const now=Date.now();
 const diffMin=(start-now)/60000;
 if(start&&diffMin<=0&&diffMin>=-180)return{status:"LIVE ACUM",boost:3,key:"live"};
 if(start&&diffMin>0&&diffMin<=120)return{status:"ÎNCEPE CURÂND",boost:2,key:"soon"};
 return{status:"PRE-MATCH",boost:0,key:"prematch"};
}

async function oddsFetch(url){
 const r=await fetch(url,{cache:"no-store"});
 let data=null;
 try{data=await r.json()}catch(e){}
 return{ok:r.ok,status:r.status,data};
}

async function getSoccerSports(key){
 const url=`${ODDS_BASE}/sports/?apiKey=${key}`;
 const r=await oddsFetch(url);

 if(!r.ok||!Array.isArray(r.data))return["soccer"];

 const sports=r.data.filter(s=>String(s.key||"").startsWith("soccer_")&&s.active!==false);

 const priority=[
  "soccer",
  "soccer_fifa_world_cup",
  "soccer_uefa_european_championship",
  "soccer_conmebol_copa_america",
  "soccer_brazil_campeonato",
  "soccer_brazil_serie_b",
  "soccer_japan_j_league",
  "soccer_japan_j_league_2",
  "soccer_norway_eliteserien",
  "soccer_sweden_allsvenskan",
  "soccer_korea_kleague1",
  "soccer_usa_mls",
  "soccer_china_superleague",
  "soccer_argentina_primera_division"
 ];

 const keys=[...new Set(["soccer",...priority,...sports.map(s=>s.key)])];
 return keys.slice(0,MAX_SPORTS_TO_SCAN);
}

async function getOddsForSport(sport,key){
 const url=`${ODDS_BASE}/sports/${sport}/odds?apiKey=${key}&regions=eu&markets=${MARKETS.join(",")}&oddsFormat=decimal&dateFormat=iso`;
 const r=await oddsFetch(url);
 return r.ok&&Array.isArray(r.data)?r.data:[];
}

async function footballFetch(path,key){
 const r=await fetch(`${FOOTBALL_API}${path}`,{headers:{"x-apisports-key":key}});
 if(!r.ok)return null;
 return await r.json();
}

const teamCache=new Map();
const statsCache=new Map();

async function findTeamId(name,key){
 if(teamCache.has(name))return teamCache.get(name);
 const data=await footballFetch(`/teams?search=${encodeURIComponent(name)}`,key);
 const id=data?.response?.[0]?.team?.id||null;
 teamCache.set(name,id);
 return id;
}

function formString(fixtures,teamId){
 let out=[];
 for(const f of fixtures||[]){
  const h=f.teams?.home?.id===teamId;
  const a=f.teams?.away?.id===teamId;
  if(!h&&!a)continue;
  const hg=f.goals?.home,ag=f.goals?.away;
  if(hg==null||ag==null)continue;
  const gf=h?hg:ag;
  const ga=h?ag:hg;
  out.push(gf>ga?"W":gf===ga?"D":"L");
  if(out.length>=5)break;
 }
 return out.join("")||"n/a";
}

function formPoints(form){
 return [...(form||"")].reduce((s,x)=>s+(x==="W"?3:x==="D"?1:0),0);
}

async function getFootballStats(home,away,key){
 if(!key){
  return{boost:0,note:"API_FOOTBALL_KEY lipsește. Folosesc doar cotele.",homeForm:"n/a",awayForm:"n/a",h2hCount:0};
 }

 const cacheKey=home+"|"+away;
 if(statsCache.has(cacheKey))return statsCache.get(cacheKey);

 try{
  const homeId=await findTeamId(home,key);
  const awayId=await findTeamId(away,key);

  if(!homeId||!awayId){
   const v={boost:0,note:"Nu am găsit echipele în API-FOOTBALL. Folosesc doar cotele.",homeForm:"n/a",awayForm:"n/a",h2hCount:0};
   statsCache.set(cacheKey,v);
   return v;
  }

  const [hf,af,h2h]=await Promise.all([
   footballFetch(`/fixtures?team=${homeId}&last=5`,key),
   footballFetch(`/fixtures?team=${awayId}&last=5`,key),
   footballFetch(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`,key)
  ]);

  const homeForm=formString(hf?.response,homeId);
  const awayForm=formString(af?.response,awayId);
  const hp=formPoints(homeForm);
  const ap=formPoints(awayForm);
  const h2hCount=h2h?.response?.length||0;

  let boost=0;
  const diff=Math.abs(hp-ap);
  if(diff>=6)boost+=3;
  else if(diff>=3)boost+=2;
  if(h2hCount>=3)boost+=1;

  const v={
   boost,
   homeForm,
   awayForm,
   h2hCount,
   note:`Formă recentă: ${home} ${homeForm} (${hp}p), ${away} ${awayForm} (${ap}p). Bonus API-FOOTBALL: +${boost}.`
  };

  statsCache.set(cacheKey,v);
  return v;
 }catch(e){
  const v={boost:0,note:"API-FOOTBALL nu a putut fi citit complet. Folosesc doar cotele.",homeForm:"n/a",awayForm:"n/a",h2hCount:0};
  statsCache.set(cacheKey,v);
  return v;
 }
}

export default async function handler(req,res){
 const oddsKey=process.env.ODDS_API_KEY;
 const footballKey=process.env.API_FOOTBALL_KEY;

 if(!oddsKey){
  return res.status(500).json({
   error:"Lipsește ODDS_API_KEY în Vercel.",
   help:"Adaugă ODDS_API_KEY în Environment Variables și Redeploy."
  });
 }

 try{
  const sports=await getSoccerSports(oddsKey);
  let events=[];

  for(const sport of sports){
   const rows=await getOddsForSport(sport,oddsKey);
   for(const ev of rows){
    events.push({...ev,sportKey:sport});
   }
  }

  const seen=new Set();
  events=events.filter(ev=>{
   const id=ev.id||`${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
   if(seen.has(id))return false;
   seen.add(id);
   return true;
  });

  let eventsChecked=events.length;
  let outcomesChecked=0;
  let bestSafe=null;
  let bestOverall=null;
  let firstAvailable=null;
  let topOverall=[];

  let marketStats={h2h:0,totals:0,spreads:0,other:0};
  let timeStats={live:0,soon:0,prematch:0};

  for(const ev of events){
   const home=ev.home_team||"Gazde";
   const away=ev.away_team||"Oaspeți";

   const ti=timeInfo(ev.commence_time);
   timeStats[ti.key]=(timeStats[ti.key]||0)+1;

   const footballStats=await getFootballStats(home,away,footballKey);

   for(const bookmaker of (ev.bookmakers||[])){
    for(const market of (bookmaker.markets||[])){
     const mk=market.key||"unknown";
     const cat=category(mk);
     marketStats[cat]=(marketStats[cat]||0)+(market.outcomes||[]).length;

     for(const outcome of (market.outcomes||[])){
      outcomesChecked++;
      const odd=Number(outcome.price);
      if(!odd)continue;

      const score=Math.max(0,Math.min(95,baseScore(odd,mk)+Number(footballStats.boost||0)+ti.boost));

      const candidate={
       match:`${home} vs ${away}`,
       pick:pickLabel(outcome,mk,home,away),
       marketKey:mk,
       marketLabel:marketLabel(mk),
       odd:odd.toFixed(2),
       safeScore:score,
       startTime:roDate(ev.commence_time),
       timeStatus:ti.status,
       timeBoost:ti.boost,
       sportKey:ev.sportKey,
       bookmaker:bookmaker.title||"Bookmaker",
       footballStats,
       reason:score>=MIN_SAFE_SCORE
        ?`Selecția trece pragul SafeBet. Bonus timp: +${ti.boost}, API-FOOTBALL: +${footballStats.boost||0}.`
        :`Nu recomand pariu: Safe Score ${score}/100 este sub pragul 75/100, dar acesta este cel mai bun găsit.`,
       rejectReason:`Safe Score ${score}/100 este sub pragul minim ${MIN_SAFE_SCORE}/100.`,
       verdict:score>=MIN_SAFE_SCORE?"JOACĂ":"CEL MAI BUN GĂSIT",
       rawScore:score
      };

      if(!firstAvailable)firstAvailable=candidate;
      if(!bestOverall||candidate.rawScore>bestOverall.rawScore)bestOverall=candidate;
      addTop(topOverall,{...candidate});

      if(score>=MIN_SAFE_SCORE&&odd>=1.12&&odd<=1.65){
       if(!bestSafe||candidate.rawScore>bestSafe.rawScore)bestSafe=candidate;
      }
     }
    }
   }
  }

  const report={
   eventsChecked,
   outcomesChecked,
   minSafeScore:MIN_SAFE_SCORE,
   scannedAt:roDate(new Date().toISOString()),
   sportsScanned:sports.length,
   sportsUsed:sports,
   marketStats,
   timeStats,
   bestOverall:clean(bestOverall),
   firstAvailable:clean(firstAvailable),
   topOverall:topOverall.map(clean)
  };

  if(bestSafe){
   bestSafe.verdict="JOACĂ";
   return res.status(200).json({
    accepted:true,
    tip:clean(bestSafe),
    report,
    message:"Recomandare peste pragul minim."
   });
  }

  return res.status(200).json({
   accepted:false,
   tip:clean(bestOverall||firstAvailable),
   report,
   message:"Nu recomand pariu acum, dar afișez cea mai bună selecție găsită."
  });

 }catch(e){
  return res.status(500).json({
   error:"Nu am putut citi datele din API.",
   help:"Verifică logurile Vercel."
  });
 }
}
