# Faktura – přepsání odběratele

Jednoduchá stránka: ručně se vybere PDF faktura, na 1. straně se najde **adresa a DIČ odběratele**,
oba údaje jdou upravit a uloží se nové PDF (`<název>-upraveno.pdf`).

- Všechno běží **jen v prohlížeči** – faktura se nikam neodesílá, žádný server, databáze ani Make.
- Adresa se hledá podle popisku (Odběratel, Kupující, Zákazník, Příjemce, Bill to, Customer …),
  DIČ podle popisku DIČ / VAT ID / IČ DPH nejblíž pod adresou (DIČ dodavatele se přeskočí).
- Když se blok najde špatně, řádky se označí kliknutím v náhledu (režim „řádek adresy“ / „řádek s DIČ“).
- Původní text se z obsahu PDF **odstraní** (textové operátory se nahradí posunem stejné šířky, viz
  `public/prepis-obsahu.js`), ne jen překryje – v novém souboru nejde označit ani vytěžit.
  Kde se odstranit nepodaří, překryje se bílou plochou a stránka to ohlásí.
- Nový text se píše fontem Liberation Sans (česká diakritika). Funguje jen pro textová PDF,
  naskenované obrázky ne.

## Soubory

- `public/index.html` – stránka (náhled, rozpoznání, formulář, zápis do PDF)
- `public/prepis-obsahu.js` – odstranění původního textu z obsahového proudu stránky
- `public/lib/` – pdf.js 3.11.174 (čtení textu, náhled), pdf-lib 1.17.1 + fontkit (zápis); uložené v repozitáři, bez CDN
- `public/fonts/` – Liberation Sans Regular/Bold (licence SIL OFL)

## Nasazení

Netlify, nasazuje se z větve `main` (publish `public/`, bez buildu – viz `netlify.toml`).
Lokálně: ve složce projektu `python3 -m http.server 8080 -d public` a otevřít http://localhost:8080/
(otevření souboru dvojklikem nestačí, prohlížeč by nepustil načtení fontů).
