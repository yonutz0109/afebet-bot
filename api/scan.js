const ODDS_API="https://api.the-odds-api.com/v4/sports/soccer/odds";
const MIN_SAFE_SCORE=75;
const MARKETS=["h2h","totals","spreads"];

function marketLabel(k){return({h2h:"1X2",totals:"Goluri over/under",spreads:"Handicap"}[k]||k||"necunoscută")}
function category(k){if(k==="h2h")return"h2h";if((k||"").includes("total"))return"totals";if((k||"").includes("spread"))return"spreads";return"other"}
function scoreFromOdd(odd,market){let s=Math.round((1/Number(odd))*100);if(market==="h2h")s-=4;if((market||"").includes("total"))s-=1;if((market||"").includes("spread"))s-=3;if(odd>=1.12&&odd<=1.45)s+=8;if(odd>1.65)s-=20;if(odd>1.90)s-=30;return Math.max(0,Math.min(95,s))}
function pickLabel(outcome,market,home,away){let n=outcome?.name||"";let p=outcome?.point!=null?` ${outcome.point}`:"";if(market==="h2h"){if(n===home)return"1 - câștigă gazdele";if(n===away)return"2 - câștigă oaspeții";if(n==="Draw")return"X - egal"}if((market||"").includes("total"))return `${n}${p} goluri`;if((market||"").includes("spread"))return `${n} handicap ${p}`;return `${n}${p}`.trim()||"Selecție necunoscută"}
function roDate(iso){return iso?new Date(iso).toLocaleString("ro-RO",{timeZone:"Europe/Bucharest"}):""}
function addTop(list,c){list.push(c);list.sort((a,b)=>(b.safeScore||0)-(a.safeScore||0));if(list.length>5)list.pop()}
function clean(c){if(!c)return c;const x={...c};delete x.rawScore;return x}

export default async function handler(req,res){
 const oddsKey=process.env.ODDS_API_KEY;
 if(!oddsKey)return res.status(500).json({error:"Lipsește ODDS_API_KEY în Vercel.",help:"Adaugă ODDS_API_KEY în Environment Variables și Redeploy."});

 try{
  const url=`${ODDS_API}?apiKey=${oddsKey}&regions=eu&markets=${MARKETS.join(",")}&oddsFormat=decimal&dateFormat=iso`;
  const r=await fetch(url,{cache:"no-store"});
  const data=await r.json();

  if(!r.ok)return res.status(500).json({error:data?.message||"The Odds API a returnat eroare.",help:"Dacă totals/spreads nu sunt permise pe planul tău, refacem pe h2h doar."});

  let eventsChecked=Array.isArray(data)?data.length:0,outcomesChecked=0,bestSafe=null,bestOverall=null,firstAvailable=null,topOverall=[];
  let marketStats={h2h:0,totals:0,spreads:0,other:0};

  for(const ev of (data||[])){
   const home=ev.home_team||"Gazde", away=ev.away_team||"Oaspeți";
   for(const bookmaker of (ev.bookmakers||[])){
    for(const market of (bookmaker.markets||[])){
     const mk=market.key||"unknown", cat=category(mk);
     marketStats[cat]=(marketStats[cat]||0)+(market.outcomes||[]).length;

     for(const outcome of (market.outcomes||[])){
      outcomesChecked++;
      const odd=Number(outcome.price);
      if(!odd)continue;

      const score=scoreFromOdd(odd,mk);
      const candidate={
       match:`${home} vs ${away}`,
       pick:pickLabel(outcome,mk,home,away),
       marketKey:mk,
       marketLabel:marketLabel(mk),
       odd:odd.toFixed(2),
       safeScore:score,
       startTime:roDate(ev.commence_time),
       bookmaker:bookmaker.title||"Bookmaker",
       reason:score>=MIN_SAFE_SCORE
        ?"Selecția trece pragul SafeBet."
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
   marketStats,
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
