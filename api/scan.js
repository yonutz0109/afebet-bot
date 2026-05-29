const ODDS_API = "https://api.the-odds-api.com/v4/sports/soccer/odds";
const MIN_SAFE_SCORE = 75;
function impliedProb(odd){return 1/Number(odd)}
function safeScore(odd, marketKey){const prob=impliedProb(odd);let score=Math.round(prob*100);if(marketKey==="h2h")score-=4;if(odd>=1.12&&odd<=1.45)score+=8;if(odd>1.65)score-=20;return Math.max(0,Math.min(95,score))}
function labelPick(outcomeName, marketKey, home, away){if(marketKey==="h2h"){if(outcomeName===home)return"1 - câștigă gazdele";if(outcomeName===away)return"2 - câștigă oaspeții";if(outcomeName==="Draw")return"X - egal"}return outcomeName}
function roDate(iso){if(!iso)return"";return new Date(iso).toLocaleString("ro-RO",{timeZone:"Europe/Bucharest"})}
export default async function handler(req,res){
 const key=process.env.ODDS_API_KEY;
 if(!key){return res.status(500).json({error:"Lipsește ODDS_API_KEY în Vercel.",help:"Vercel → proiect → Environment Variables → adaugă ODDS_API_KEY, apoi Redeploy."})}
 const url=`${ODDS_API}?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso`;
 try{
  const r=await fetch(url); const data=await r.json();
  if(!r.ok){return res.status(500).json({error:data?.message||"The Odds API a returnat eroare.",help:"Verifică cheia ODDS_API_KEY și numărul de request-uri disponibile."})}
  let bestSafe=null,bestRejected=null,eventsChecked=0,outcomesChecked=0;
  for(const event of data){
   eventsChecked++; const home=event.home_team, away=event.away_team;
   for(const bookmaker of event.bookmakers||[]){
    const market=bookmaker.markets?.find(m=>m.key==="h2h"); if(!market)continue;
    for(const outcome of market.outcomes||[]){
     outcomesChecked++; const odd=Number(outcome.price); if(!odd)continue;
     const score=safeScore(odd,market.key);
     const candidate={match:`${home} vs ${away}`,pick:labelPick(outcome.name,market.key,home,away),odd:odd.toFixed(2),safeScore:score,startTime:roDate(event.commence_time),reason:`Cotă analizată din piața 1X2. Bookmaker: ${bookmaker.title}.`,bookmaker:bookmaker.title,rejectReason:score<MIN_SAFE_SCORE?`Safe Score ${score}/100 este sub pragul minim ${MIN_SAFE_SCORE}/100.`:"A fost respins de filtrele de cotă/risc.",rawScore:score};
     if(score>=MIN_SAFE_SCORE&&odd>=1.12&&odd<=1.65){if(!bestSafe||candidate.rawScore>bestSafe.rawScore)bestSafe=candidate}
     else{if(!bestRejected||candidate.rawScore>bestRejected.rawScore)bestRejected=candidate}
    }
   }
  }
  const reportBase={eventsChecked,outcomesChecked,minSafeScore:MIN_SAFE_SCORE,scannedAt:roDate(new Date().toISOString())};
  if(bestSafe){delete bestSafe.rawScore;return res.status(200).json({tip:bestSafe,report:reportBase})}
  if(bestRejected)delete bestRejected.rawScore;
  return res.status(200).json({tip:null,report:{...reportBase,bestRejected}});
 }catch(e){return res.status(500).json({error:"Nu am putut citi datele de cote.",help:"Încearcă din nou sau verifică logurile din Vercel."})}
}