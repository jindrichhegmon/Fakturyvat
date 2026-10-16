# Faktura – přepsání odběratele

Jednoduchá stránka: ručně se vybere PDF faktura, na 1. straně se najde **adresa, IČO a DIČ odběratele**,
všechny údaje jdou upravit a uloží se nové PDF (`<název>-upraveno.pdf`).

- Všechno běží **jen v prohlížeči** – faktura se nikam neodesílá, žádný server, databáze ani Make.
- Adresa se hledá podle popisku (Odběratel, Kupující, Zákazník, Příjemce, Bill to, Customer …),
  IČO a DIČ podle popisku (IČO / IČ / ID, DIČ / VAT ID / IČ DPH / CIF/NIF / NIF / USt-IdNr) nejblíž pod adresou
  (údaje dodavatele se přeskočí). Faktura bez popisku odběratele (např. španělská): blok adresy = řádky těsně nad
  řádkem s DIČ ve stejném sloupci.
  Řádek s IČO a DIČ se přepíše celý (popisek + nová hodnota); prázdné pole řádek z faktury odstraní.
  Když je DIČ na faktuře víckrát (DIČ i IČ DPH), přepíšou se všechny řádky v bloku odběratele.
- Když má nová adresa víc řádků než označený blok, další řádky se napíšou pod něj; pokud by se překryly
  s jiným textem, stránka upozorní a je třeba označit i zbylé řádky původní adresy.
- Řádky zarovnané mezerami (Alza apod.): jeden příkaz v PDF nese celý řádek. Odstraní se celý a části, které se
  nemění (popisky, data vlevo), se napíšou znovu na původní místo.
- Když se blok najde špatně, řádky se označí kliknutím v náhledu (režim „řádek adresy“ / „řádek s IČO“ / „řádek s DIČ“).
- Původní text se z obsahu PDF **odstraní** (textové operátory se nahradí posunem stejné šířky, viz
  `public/prepis-obsahu.js`), ne jen překryje – v novém souboru nejde označit ani vytěžit.
  Kde se odstranit nepodaří, překryje se bílou plochou a stránka to ohlásí.
- Nový text se píše fontem Liberation Sans (česká diakritika). Když je delší než původní místo (po další text
  vpravo nebo po okraj stránky), písmo se automaticky zmenší, aby nepřetekl rámeček; ručně zadaná velikost má přednost. Funguje jen pro textová PDF,
  naskenované obrázky ne.

- Náhled výsledku je hned vedle originálu a přepisuje se sám při každé úpravě; stažení až tlačítkem.
- **Předvolení odběratelé** – nabídka „Vybrat odběratele“ vyplní adresu, IČO i DIČ. Seznam je v `public/odberatele.js`
  (název, řádky adresy, IČO, DIČ); další odběratel = další položka v poli.

## Soubory

- `public/index.html` – stránka (náhled, rozpoznání, formulář, zápis do PDF)
- `public/odberatele.js` – předvolení odběratelé pro nabídku ve formuláři
- `public/prepis-obsahu.js` – odstranění původního textu z obsahového proudu stránky
- `public/lib/` – pdf.js 3.11.174 (čtení textu, náhled), pdf-lib 1.17.1 + fontkit (zápis); uložené v repozitáři, bez CDN
- `public/fonts/` – Liberation Sans Regular/Bold (licence SIL OFL)

## Nasazení

Netlify, nasazuje se z větve `main` (publish `public/`, bez buildu – viz `netlify.toml`).
Lokálně: ve složce projektu `python3 -m http.server 8080 -d public` a otevřít http://localhost:8080/
(otevření souboru dvojklikem nestačí, prohlížeč by nepustil načtení fontů).
