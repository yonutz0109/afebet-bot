# ADAM Web — ghid de deploy (gratuit, acces de pe iPhone de oriunde)

## Ce ai primit
- `app.py` — server Flask (backend)
- `adam_engine.py` — motorul de calcul ADAM (probabilitate din cote + formă + statistici ligă)
- `templates/index.html` — interfața web, optimizată pentru mobil/iPhone
- `requirements.txt` — librării Python necesare
- `render.yaml` — config pentru deploy automat pe Render.com

## Pași de deploy (10 minute, fără cunoștințe tehnice)

### 1. Cont GitHub (dacă nu ai deja)
Mergi pe **github.com** → Sign up → cont gratuit.

### 2. Urcă fișierele pe GitHub
- Creează un repository nou (buton verde "New")
- Numește-l `adam-dashboard`
- Bifează "Public" sau "Private" (oricare merge)
- Apasă "uploading an existing file" și trage toate fișierele din acest folder

### 3. Cont Render.com
Mergi pe **render.com** → Sign up → conectează-te cu contul GitHub (cel mai simplu).

### 4. Deploy
- În Render: **New +** → **Web Service**
- Selectează repository-ul `adam-dashboard` de pe GitHub
- Render detectează automat `render.yaml` și completează totul singur
- La secțiunea **Environment Variables**, adaugă:
  - `API_SPORTS_KEY` = cheia ta de pe api-football.com
  - `ODDS_API_KEY` = cheia ta de pe the-odds-api.com (dacă vrei tenis)
- Apasă **Create Web Service**

### 5. Așteaptă 2-3 minute
Render îți construiește și pornește serverul. Primești un link de tipul:
`https://adam-dashboard-xxxx.onrender.com`

### 6. Pe iPhone
- Deschide linkul în **Safari**
- Apasă butonul de **Share** (pătrat cu săgeată în sus)
- **Add to Home Screen**
- Acum ai o icoană "ADAM" pe ecranul principal, ca o aplicație nativă

## Notă despre planul gratuit Render
Planul free "adoarme" serverul după 15 minute de inactivitate. Prima accesare după pauză durează ~30-50 secunde să pornească din nou (e normal, e gratuit). Dacă vrei să rămână mereu activ, planul plătit pornește de la $7/lună.

## Securitate
Cheile API stau **doar pe server** (Environment Variables din Render), niciodată pe telefon sau în cod. Nimeni care accesează link-ul nu poate vedea cheile tale.

## Ce face diferit față de aplicația desktop
- Cotele și predicțiile sunt calculate cu motorul v3 (probabilitate reală din cote, nu scoruri fixe)
- Interfața e gândită pentru atingere — carduri mari, swipe, taps
- Apăsând pe un meci se extinde cu detalii (motiv calcul, scor estimat, risc)
