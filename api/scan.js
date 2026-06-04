
 const cacheKey=home+"|"+away;
 if(statsCache.has(cacheKey))return statsCache.get(cacheKey);
 try{
  const homeId=await findTeamId(home,key);
  const awayId=await findTeamId(away,key);
  if(!homeId||!awayId){
   const v={boost:0,note:"Nu am găsit echipele în API-FOOTBALL. Folosesc doar cotele.",homeForm:"n/a",awayForm:"n/a",h2hCount:0};
   statsCache.set(cacheKey,v);return v;
  }
  const [hf,af,h2h]=await Promise.all([
   footballFetch(`/fixtures?team=${homeId}&last=5`,key),
   footballFetch(`/fixtures?team=${awayId}&last=5`,key),
   footballFetch(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`,key)
  ]);
  const homeForm=formString(hf?.response,homeId);
  const awayForm=formString(af?.response,awayId);
  const hp=formPoints(homeForm),ap=formPoints(awayForm),h2hCount=h2h?.response?.length||0;
  let boost=0,diff=Math.abs(hp-ap);
  if(diff>=6)boost+=3;else if(diff>=3)boost+=2;
  if(h2hCount>=3)boost+=1;
  const v={boost,homeForm,awayForm,h2hCount,note:`Formă recentă: ${home} ${homeForm} (${hp}p), ${away} ${awayForm} (${ap}p). Bonus API-FOOTBALL: +${boost}.`};
  statsCache.set(cacheKey,v);return v;
 }catch(e){
  const v={boost:0,note:"API-FOOTBALL nu a putut fi citit complet. Folosesc doar cotele.",homeForm:"n/a",awayForm:"n/a",h2hCount:0};
  statsCache.set(cacheKey,v);return v;
 }
}

function liveScoreCandidate(fix){
 const home=fix.teams?.home?.name||"Gazde",away=fix.teams?.away?.name||"Oaspeți";
 const hg=Number(fix.goals?.home??0),ag=Number(fix.goals?.away??0);
 const minute=Number(fix.fixture?.status?.elapsed||0);
 const status=fix.fixture?.status?.short||"LIVE";
 const total=hg+ag;
 let picks=[];
 const base={match:`${home} vs ${away}`,startTime:roDate(fix.fixture?.date),timeStatus:"LIVE ACUM",timeBoost:3,bookmaker:"API-FOOTBALL LIVE",footballStats:{boost:3,homeForm:"live",awayForm:"live",h2hCount:0,note:`Live ${minute}' scor ${hg}-${ag}, status ${status}.`},live:{minute,score:`${hg}-${ag}`,status}};
 if(minute>=15&&minute<=75){
  if(total<=1)picks.push({...base,pick:"LIVE peste 1.5 goluri",marketKey:"live_over15",marketLabel:"LIVE peste 1.5",odd:"n/a",safeScore:78,reason:"Meci live în interval bun, scor cu potențial pentru încă un gol.",verdict:"JOACĂ",rawScore:78});
  if(total<=2&&minute<=65)picks.push({...base,pick:"LIVE peste 2.5 goluri",marketKey:"live_over25",marketLabel:"LIVE peste 2.5",odd:"n/a",safeScore:73,reason:"Meci live cu timp suficient pentru încă goluri, dar sub prag.",verdict:"CEL MAI BUN GĂSIT",rawScore:73});
  if(hg>ag&&minute>=60)picks.push({...base,pick:`${home} să nu piardă live`,marketKey:"live_home",marketLabel:"LIVE avantaj gazde",odd:"n/a",safeScore:80,reason:"Gazdele conduc live după minutul 60.",verdict:"JOACĂ",rawScore:80});
  if(ag>hg&&minute>=60)picks.push({...base,pick:`${away} să nu piardă live`,marketKey:"live_away",marketLabel:"LIVE avantaj oaspeți",odd:"n/a",safeScore:80,reason:"Oaspeții conduc live după minutul 60.",verdict:"JOACĂ",rawScore:80});
 }
 return picks;
}

async function getLiveFootballCandidates(key){
 if(!key)return{fixtures:[],candidates:[],error:"API_FOOTBALL_KEY lipsește"};
 const data=await footballFetch(`/fixtures?live=all`,key);
 const fixtures=Array.isArray(data?.response)?data.response:[];
 let candidates=[];
 for(const fix of fixtures)candidates.push(...liveScoreCandidate(fix));
 return{fixtures,candidates,error:null};
}

export default async function handler(req,res){
 const oddsKey=process.env.ODDS_API_KEY,footballKey=process.env.API_FOOTBALL_KEY;
 if(!oddsKey)return res.status(500).json({error:"Lipsește ODDS_API_KEY în Vercel.",help:"Adaugă ODDS_API_KEY în Environment Variables și Redeploy."});

 try{
  const sports=await getSoccerSports(oddsKey);
  let events=[];
  for(const sport of sports){
   const rows=await getOddsForSport(sport,oddsKey);
   for(const ev of rows)events.push({...ev,sportKey:sport});
  }

  const seen=new Set();
  events=events.filter(ev=>{
   const id=ev.id||`${ev.home_team}|${ev.away_team}|${ev.commence_time}`;
   if(seen.has(id))return false;
   seen.add(id);
   return true;
  });

  const livePack=await getLiveFootballCandidates(footballKey);

  let eventsChecked=events.length;
  let outcomesChecked=0;
  let bestSafe=null;
  let bestOverall=null;
  let firstAvailable=null;
  let topOverall=[];

  let marketStats={h2h:0,totals:0,spreads:0,other:0,live:0};
  let timeStats={live:livePack.fixtures.length,soon:0,prematch:0};

  for(const liveCandidate of livePack.candidates){
   outcomesChecked++;
   marketStats.live++;
   if(!firstAvailable)firstAvailable=liveCandidate;
   if(!bestOverall||liveCandidate.rawScore>bestOverall.rawScore)bestOverall=liveCandidate;
   addTop(topOverall,{...liveCandidate});
   if(liveCandidate.safeScore>=MIN_SAFE_SCORE){
    if(!bestSafe||liveCandidate.rawScore>bestSafe.rawScore)bestSafe=liveCandidate;
   }
  }

  for(const ev of events){
   const home=ev.home_team||"Gazde",away=ev.away_team||"Oaspeți";
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
   eventsChecked:eventsChecked+livePack.fixtures.length,
   outcomesChecked,
   minSafeScore:MIN_SAFE_SCORE,
   scannedAt:roDate(new Date().toISOString()),
   sportsScanned:sports.length,
   sportsUsed:sports,
   liveFixtures:livePack.fixtures.length,
   liveError:livePack.error,
   marketStats,
   timeStats,
   bestOverall:clean(bestOverall),
   firstAvailable:clean(firstAvailable),
   topOverall:topOverall.map(clean)
  };

  if(bestSafe){
   bestSafe.verdict="JOACĂ";
   return res.status(200).json({accepted:true,tip:clean(bestSafe),report,message:"Recomandare peste pragul minim."});
  }

  return res.status(200).json({accepted:false,tip:clean(bestOverall||firstAvailable),report,message:"Nu recomand pariu acum, dar afișez cea mai bună selecție găsită."});

 }catch(e){
  return res.status(500).json({error:"Nu am putut citi datele din API.",help:"Verifică logurile Vercel."});
 }
}
