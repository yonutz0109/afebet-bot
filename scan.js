const ODDS_API="https://api.the-odds-api.com/v4/sports/soccer/odds";
const FOOTBALL_API="https://v3.football.api-sports.io";
const MIN_SAFE_SCORE=75;
const MARKETS=["h2h","totals","spreads","alternate_totals","alternate_spreads","team_totals","corners","alternate_corners","cards"];

function marketLabel(k){
  return({
    h2h:"1X2",
    totals:"Goluri over/under",
    alternate_totals:"Goluri alternative",
    spreads:"Handicap",
    alternate_spreads:"Handicap alternativ",
    team_totals:"Goluri echipă",
    corners:"Cornere",
    alternate_corners:"Cornere alternative",
    cards:"Cartonașe"
  }[k]||k);
}
function category(k){
  if(k==="h2h")return"h2h";
  if(k.includes("total"))return"totals";
  if(k.includes("spread"))return"spreads";
  if(k.includes("corner"))return"corners";
  if(k.includes("card"))return"cards";
  return"other";
}
function baseSafeScore(odd,key){
  let s=Math.round((1/Number(odd))*100);
  if(key==="h2h")s-=4;
  if(key.includes("total"))s-=1;
  if(key.includes("spread"))s-=3;
  if(key.includes("corner"))s-=7;
  if(key.includes("card"))s-=8;
  if(odd>=1.12&&odd<=1.45)s+=8;
  if(odd>1.65)s-=20;
  if(odd>1.90)s-=30;
  return Math.max(0,Math.min(95,s));
}
function pickLabel(outcome,market,home,away){
  let n=outcome.name||"";
  let p=outcome.point!=null?` ${outcome.point}`:"";
  if(market==="h2h"){
    if(n===home)return"1 - câștigă gazdele";
    if(n===away)return"2 - câștigă oaspeții";
    if(n==="Draw")return"X - egal";
  }
  if(market.includes("total"))return `${n}${p} goluri`;
  if(market.includes("spread"))return `${n} handicap ${p}`;
  if(market.includes("corner"))return `${n}${p} cornere`;
  if(market.includes("card"))return `${n}${p} cartonașe`;
  return `${n}${p}`;
}
function roDate(iso){
  return iso?new Date(iso).toLocaleString("ro-RO",{timeZone:"Europe/Bucharest"}):"";
}
async function ff(path,key){
  let r=await fetch(`${FOOTBALL_API}${path}`,{headers:{"x-apisports-key":key}});
  if(!r.ok)return null;
  return await r.json();
}
const statsCache=new Map();
async function getStats(home,away,footballKey){
  let cacheKey=home+"|"+away;
  if(statsCache.has(cacheKey))return statsCache.get(cacheKey);
  if(!footballKey){
    let v={note:"API_FOOTBALL_KEY nu este setată. Folosesc doar cotele.",boost:0};
    statsCache.set(cacheKey,v);return v;
  }
  try{
    let hs=await ff(`/teams?search=${encodeURIComponent(home)}`,footballKey);
    let as=await ff(`/teams?search=${encodeURIComponent(away)}`,footballKey);
    let hid=hs?.response?.[0]?.team?.id;
    let aid=as?.response?.[0]?.team?.id;
    if(!hid||!aid){
      let v={note:"Nu am găsit echipele în API-FOOTBALL pentru statistici exacte.",boost:0};
      statsCache.set(cacheKey,v);return v;
    }
    let h2h=await ff(`/fixtures/headtohead?h2h=${hid}-${aid}&last=5`,footballKey);
    let n=h2h?.response?.length||0;
    let boost=n>=3?2:0;
    let v={
      note:`Echipe găsite în API-FOOTBALL. H2H disponibile: ${n}.`,
      boost,
      h2hCount:n,
      league:h2h?.response?.[0]?.league?.name||"n/a",
      country:h2h?.response?.[0]?.league?.country||"n/a"
    };
    statsCache.set(cacheKey,v);return v;
  }catch(e){
    let v={note:"API-FOOTBALL a răspuns incomplet. Folosesc scorul pe cote.",boost:0};
    statsCache.set(cacheKey,v);return v;
  }
}
function addTop(list,c){
  list.push(c);
  list.sort((a,b)=>b.safeScore-a.safeScore);
  if(list.length>5)list.pop();
}
function clean(c){
  if(!c)return c;
  let x={...c};
  delete x.rawScore;
  return x;
}

export default async function handler(req,res){
  let oddsKey=process.env.ODDS_API_KEY;
  let footballKey=process.env.API_FOOTBALL_KEY;
  if(!oddsKey){
    return res.status(500).json({error:"Lipsește ODDS_API_KEY în Vercel.",help:"Adaugă ODDS_API_KEY și Redeploy."});
  }

  try{
    let url=`${ODDS_API}?apiKey=${oddsKey}&regions=eu&markets=${MARKETS.join(",")}&oddsFormat=decimal&dateFormat=iso`;
    let r=await fetch(url,{cache:"no-store"});
    let data=await r.json();

    if(!r.ok){
      return res.status(500).json({
        error:data?.message||"The Odds API a returnat eroare.",
        help:"Dacă eroarea spune că o piață nu este disponibilă, facem fallback la piețele acceptate pe planul tău."
      });
    }

    let bestSafe=null;
    let bestOverall=null;
    let topOverall=[];
    let eventsChecked=0;
    let outcomesChecked=0;
    let marketStats={h2h:0,totals:0,spreads:0,corners:0,cards:0};

    for(const ev of data){
      eventsChecked++;
      let home=ev.home_team;
      let away=ev.away_team;
      let footballStats=await getStats(home,away,footballKey);

      for(const bookmaker of ev.bookmakers||[]){
        for(const market of bookmaker.markets||[]){
          let mk=market.key;
          let cat=category(mk);
          if(marketStats[cat]!==undefined)marketStats[cat]+=(market.outcomes||[]).length;

          for(const outcome of market.outcomes||[]){
            outcomesChecked++;
            let odd=Number(outcome.price);
            if(!odd)continue;

            let score=Math.max(0,Math.min(95,baseSafeScore(odd,mk)+Number(footballStats.boost||0)));
            let candidate={
              match:`${home} vs ${away}`,
              pick:pickLabel(outcome,mk,home,away),
              marketKey:mk,
              marketLabel:marketLabel(mk),
              odd:odd.toFixed(2),
              safeScore:score,
              startTime:roDate(ev.commence_time),
              bookmaker:bookmaker.title,
              footballStats,
              reason:`Selectată ca cea mai safe opțiune disponibilă după cote, piață și verificare API-FOOTBALL.`,
              rejectReason:score<MIN_SAFE_SCORE?`Safe Score ${score}/100 este sub pragul minim ${MIN_SAFE_SCORE}/100.`:"Respinsă de filtrele de cotă/risc.",
              verdict:score>=MIN_SAFE_SCORE?"JOACĂ":(score>=65?"ATENȚIE":"NU JOCA"),
              rawScore:score
            };

            if(!bestOverall||candidate.rawScore>bestOverall.rawScore)bestOverall=candidate;
            addTop(topOverall,{...candidate});

            if(score>=MIN_SAFE_SCORE && odd>=1.12 && odd<=1.65){
              if(!bestSafe||candidate.rawScore>bestSafe.rawScore)bestSafe=candidate;
            }
          }
        }
      }
    }

    let report={
      eventsChecked,
      outcomesChecked,
      minSafeScore:MIN_SAFE_SCORE,
      scannedAt:roDate(new Date().toISOString()),
      marketStats,
      bestOverall:clean(bestOverall),
      topOverall:topOverall.map(clean)
    };

    if(bestSafe){
      bestSafe.verdict="JOACĂ";
      return res.status(200).json({tip:clean(bestSafe),report});
    }

    return res.status(200).json({tip:null,report});
  }catch(e){
    return res.status(500).json({
      error:"Nu am putut citi datele multi-piețe.",
      help:"Verifică logurile Vercel. Dacă The Odds API refuză piețele extinse, facem fallback pe h2h/totals/spreads."
    });
  }
}