/*
  Odstranění původního textu z PDF (pdf-lib).
  Projde obsahový proud stránky (a formulářové XObjecty), sleduje grafický i textový stav
  (q/Q, cm, BT/ET, Tm, Td, TD, T*, TL, Tf, Tc, Tw, Tz) a u každého textového operátoru
  (Tj, TJ, ', ") spočítá, kde začíná. Operátor, který začíná v některé z předaných oblastí,
  nahradí posunem „[ -N ] TJ“ se stejnou šířkou, takže ostatní text na řádku zůstane na místě
  a původní text z PDF zmizí (nejde ho označit, zkopírovat ani vytěžit).

  Použití:  const pocet = await FKObsah.odstranText(doc, page, [{ x, y, w, size }, …]);
            (souřadnice v uživatelském prostoru PDF, y = účaří řádku – jak je vrací pdf.js)
*/
window.FKObsah = (function () {
  'use strict';
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFStream, PDFRef, decodePDFRawStream, StandardFonts } = PDFLib;

  /* ---------- tokenizer obsahového proudu ---------- */
  const BILE = new Set([0, 9, 10, 12, 13, 32]);
  const ODDEL = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]); // ( ) < > [ ] { } / %
  const jeRegular = (b) => !BILE.has(b) && !ODDEL.has(b);

  function tokenizuj(bytes) {
    const tokeny = [];
    let i = 0;
    const n = bytes.length;
    const ctiToken = () => {
      while (i < n && BILE.has(bytes[i])) i++;
      if (i >= n) return null;
      const od = i;
      const b = bytes[i];
      if (b === 0x25) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; return ctiToken(); } // komentář
      if (b === 0x2f) { // jméno
        i++; let s = '';
        while (i < n && jeRegular(bytes[i])) {
          if (bytes[i] === 0x23 && i + 2 < n) { s += String.fromCharCode(parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16)); i += 3; }
          else s += String.fromCharCode(bytes[i++]);
        }
        return { typ: 'name', val: s, od, do: i };
      }
      if (b === 0x28) { // řetězec (…)
        i++; let hloubka = 1; const out = [];
        while (i < n) {
          const c = bytes[i++];
          if (c === 0x5c) { // \
            const d = bytes[i++];
            if (d === 0x6e) out.push(10); else if (d === 0x72) out.push(13); else if (d === 0x74) out.push(9); else if (d === 0x62) out.push(8); else if (d === 0x66) out.push(12);
            else if (d >= 0x30 && d <= 0x37) { let o = d - 0x30; for (let k = 0; k < 2 && i < n && bytes[i] >= 0x30 && bytes[i] <= 0x37; k++) o = o * 8 + (bytes[i++] - 0x30); out.push(o & 255); }
            else if (d === 13) { if (bytes[i] === 10) i++; } else if (d === 10) { /* pokračování řádku */ }
            else out.push(d);
          } else if (c === 0x28) { hloubka++; out.push(c); }
          else if (c === 0x29) { hloubka--; if (hloubka === 0) break; out.push(c); }
          else out.push(c);
        }
        return { typ: 'str', val: out, od, do: i };
      }
      if (b === 0x3c) {
        if (bytes[i + 1] === 0x3c) { // slovník << … >>
          i += 2; let hloubka = 1;
          while (i < n && hloubka > 0) {
            if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) { hloubka++; i += 2; }
            else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { hloubka--; i += 2; }
            else if (bytes[i] === 0x28) preskocRetezec(); // řetězec uvnitř slovníku přeskočit
            else i++;
          }
          return { typ: 'dict', od, do: i };
        }
        i++; const hex = []; // hex řetězec <…>
        while (i < n && bytes[i] !== 0x3e) { const c = bytes[i++]; if (!BILE.has(c)) hex.push(String.fromCharCode(c)); }
        i++;
        const out = []; for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex[k] + (hex[k + 1] || '0'), 16));
        return { typ: 'str', val: out, od, do: i };
      }
      if (b === 0x5b) { // pole […]
        i++; const items = [];
        for (;;) { const t = ctiToken(); if (!t || t.typ === ']') break; items.push(t); }
        return { typ: 'arr', val: items, od, do: i };
      }
      if (b === 0x5d) { i++; return { typ: ']', od, do: i }; }
      if (b === 0x7b || b === 0x7d) { i++; return { typ: 'op', val: String.fromCharCode(b), od, do: i }; }
      if (b === 0x29 || b === 0x3e) { i++; return ctiToken(); } // osamocený oddělovač – přeskočit
      let s = '';
      while (i < n && jeRegular(bytes[i])) s += String.fromCharCode(bytes[i++]);
      if (/^[+-.\d]/.test(s) && !Number.isNaN(parseFloat(s))) return { typ: 'num', val: parseFloat(s), od, do: i };
      if (s === 'ID') { // inline obrázek: binární data až po „EI“
        i++;
        while (i < n) { if (BILE.has(bytes[i - 1]) && bytes[i] === 0x45 && bytes[i + 1] === 0x49 && (i + 2 >= n || BILE.has(bytes[i + 2]))) { i += 2; break; } i++; }
        return { typ: 'op', val: 'EI', od, do: i };
      }
      return { typ: 'op', val: s, od, do: i };
    };
    const preskocRetezec = () => { // i stojí na „(“
      i++; let hloubka = 1;
      while (i < n && hloubka > 0) { const c = bytes[i++]; if (c === 0x5c) i++; else if (c === 0x28) hloubka++; else if (c === 0x29) hloubka--; }
    };
    for (;;) { const t = ctiToken(); if (!t) break; tokeny.push(t); }
    return tokeny;
  }

  /* ---------- šířky znaků fontu ---------- */
  const STD = { helvetica: StandardFonts.Helvetica, arial: StandardFonts.Helvetica, times: StandardFonts.TimesRoman, courier: StandardFonts.Courier };

  async function sirkyFontu(doc, fontDict, cache) {
    if (!fontDict) return { bajty: 1, w: () => 0.5, mat: 0.001 };
    if (cache.has(fontDict)) return cache.get(fontDict);
    const ctx = doc.context;
    const num = (o, def) => { const v = ctx.lookup(o); return v instanceof PDFNumber ? v.asNumber() : def; };
    const subtype = ctx.lookup(fontDict.get(PDFName.of('Subtype')));
    const st = subtype instanceof PDFName ? subtype.decodeText() : '';
    let vysledek;
    if (st === 'Type0') {
      const desc = ctx.lookup(fontDict.get(PDFName.of('DescendantFonts')));
      const cid = desc instanceof PDFArray ? ctx.lookup(desc.get(0), PDFDict) : null;
      const dw = cid ? num(cid.get(PDFName.of('DW')), 1000) : 1000;
      const mapa = new Map();
      const W = cid ? ctx.lookup(cid.get(PDFName.of('W'))) : null;
      if (W instanceof PDFArray) {
        const a = W.asArray().map((x) => ctx.lookup(x));
        for (let k = 0; k < a.length;) {
          const c = a[k] instanceof PDFNumber ? a[k].asNumber() : 0;
          if (a[k + 1] instanceof PDFArray) { a[k + 1].asArray().forEach((x, j) => { const v = ctx.lookup(x); if (v instanceof PDFNumber) mapa.set(c + j, v.asNumber()); }); k += 2; }
          else { const c2 = a[k + 1] instanceof PDFNumber ? a[k + 1].asNumber() : c; const wv = a[k + 2] instanceof PDFNumber ? a[k + 2].asNumber() : dw; for (let x = c; x <= c2 && x - c < 65536; x++) mapa.set(x, wv); k += 3; }
        }
      }
      vysledek = { bajty: 2, w: (kod) => (mapa.has(kod) ? mapa.get(kod) : dw) / 1000, mat: 0.001 };
    } else {
      const first = num(fontDict.get(PDFName.of('FirstChar')), 0);
      const Widths = ctx.lookup(fontDict.get(PDFName.of('Widths')));
      const fd = ctx.lookup(fontDict.get(PDFName.of('FontDescriptor')));
      const missing = fd instanceof PDFDict ? num(fd.get(PDFName.of('MissingWidth')), 0) : 0;
      let mat = 0.001;
      if (st === 'Type3') { const fm = ctx.lookup(fontDict.get(PDFName.of('FontMatrix'))); if (fm instanceof PDFArray) mat = num(fm.get(0), 0.001); }
      if (Widths instanceof PDFArray && Widths.size()) {
        const ws = Widths.asArray().map((x) => { const v = ctx.lookup(x); return v instanceof PDFNumber ? v.asNumber() : missing; });
        // šířka v textovém prostoru = w * FontMatrix (u běžných fontů 1/1000)
        vysledek = { bajty: 1, w: (kod) => (kod >= first && kod - first < ws.length ? ws[kod - first] : missing) * mat, mat };
      } else {
        // standardní font bez Widths (Helvetica, Arial, Times, Courier …) – metriky z pdf-lib, jinak odhad
        const base = ctx.lookup(fontDict.get(PDFName.of('BaseFont')));
        const jmeno = base instanceof PDFName ? base.decodeText().toLowerCase() : '';
        const klic = Object.keys(STD).find((k) => jmeno.includes(k));
        let f = null;
        if (klic) {
          const tucny = /bold/.test(jmeno), kurziva = /italic|oblique/.test(jmeno);
          let std = STD[klic];
          if (klic === 'times') std = tucny && kurziva ? StandardFonts.TimesRomanBoldItalic : tucny ? StandardFonts.TimesRomanBold : kurziva ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
          else if (klic === 'courier') std = tucny && kurziva ? StandardFonts.CourierBoldOblique : tucny ? StandardFonts.CourierBold : kurziva ? StandardFonts.CourierOblique : StandardFonts.Courier;
          else std = tucny && kurziva ? StandardFonts.HelveticaBoldOblique : tucny ? StandardFonts.HelveticaBold : kurziva ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
          try { f = cache.get('std:' + std) || await doc.embedStandardFont(std); cache.set('std:' + std, f); } catch (e) { f = null; }
        }
        vysledek = { bajty: 1, w: (kod) => { if (!f) return 0.5; try { return f.widthOfTextAtSize(String.fromCharCode(kod), 1000) / 1000; } catch (e) { return 0.5; } }, mat: 0.001 };
      }
    }
    cache.set(fontDict, vysledek);
    return vysledek;
  }

  /* ---------- interpret + úprava ---------- */
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const I = [1, 0, 0, 1, 0, 0];
  const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

  // index oblasti, ve které textový operátor začíná (-1 = žádná)
  function vOblasti(oblasti, x, y) {
    return oblasti.findIndex((o) => y > o.y - o.size * 0.45 && y < o.y + o.size * 0.55 && x > o.x - 2.5 && x < o.x + o.w - 0.5);
  }

  async function zpracujProud(doc, bytes, resources, ctm0, oblasti, cache, navstivene, pocty) {
    const tokeny = tokenizuj(bytes);
    const ctx = doc.context;
    let ctm = ctm0.slice(); const zasobnik = [];
    let Tm = I.slice(), Tlm = I.slice(), Tfs = 0, Tc = 0, Tw = 0, Th = 1, TL = 0, font = null;
    const zamena = []; // { od, do, text }
    let pocet = 0;
    let operandy = [];

    const fontDict = (jmeno) => {
      const fonts = resources ? ctx.lookupMaybe(resources.get(PDFName.of('Font')), PDFDict) : null;
      return fonts ? ctx.lookupMaybe(fonts.get(PDFName.of(jmeno)), PDFDict) : null;
    };

    const sirkaRetezce = (bajty, f) => {
      let s = 0;
      const krok = f.bajty;
      for (let k = 0; k < bajty.length; k += krok) {
        const kod = krok === 2 ? (bajty[k] << 8) | (bajty[k + 1] || 0) : bajty[k];
        s += f.w(kod) * Tfs + Tc + (kod === 32 && krok === 1 ? Tw : 0);
      }
      return s * Th;
    };

    for (const t of tokeny) {
      if (t.typ !== 'op') { operandy.push(t); continue; }
      const op = t.val;
      const cisla = operandy.filter((o) => o.typ === 'num').map((o) => o.val);
      const prvniOperand = operandy[0];
      switch (op) {
        case 'q': zasobnik.push(ctm.slice()); break;
        case 'Q': if (zasobnik.length) ctm = zasobnik.pop(); break;
        case 'cm': if (cisla.length >= 6) ctm = mul(cisla.slice(0, 6), ctm); break;
        case 'BT': Tm = I.slice(); Tlm = I.slice(); break;
        case 'Tf': if (prvniOperand && prvniOperand.typ === 'name') font = await sirkyFontu(doc, fontDict(prvniOperand.val), cache); Tfs = cisla[cisla.length - 1] || 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, cisla[0] || 0, cisla[1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'TD': TL = -(cisla[1] || 0); Tlm = mul([1, 0, 0, 1, cisla[0] || 0, cisla[1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'Tm': if (cisla.length >= 6) { Tlm = cisla.slice(0, 6); Tm = Tlm.slice(); } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); break;
        case 'TL': TL = cisla[0] || 0; break;
        case 'Tc': Tc = cisla[0] || 0; break;
        case 'Tw': Tw = cisla[0] || 0; break;
        case 'Tz': Th = (cisla[0] || 100) / 100; break;
        case 'Do': {
          if (prvniOperand && prvniOperand.typ === 'name' && resources) {
            const xobjs = ctx.lookupMaybe(resources.get(PDFName.of('XObject')), PDFDict);
            const ref = xobjs ? xobjs.get(PDFName.of(prvniOperand.val)) : null;
            const xo = ref ? ctx.lookup(ref) : null;
            if (xo instanceof PDFStream && !(ref instanceof PDFRef && navstivene.has(ref.toString()))) {
              const sub = ctx.lookup(xo.dict.get(PDFName.of('Subtype')));
              if (sub instanceof PDFName && sub.decodeText() === 'Form') {
                if (ref instanceof PDFRef) navstivene.add(ref.toString());
                const mtx = ctx.lookup(xo.dict.get(PDFName.of('Matrix')));
                const m = mtx instanceof PDFArray ? mtx.asArray().map((x) => { const v = ctx.lookup(x); return v instanceof PDFNumber ? v.asNumber() : 0; }) : I;
                const res = ctx.lookupMaybe(xo.dict.get(PDFName.of('Resources')), PDFDict) || resources;
                const data = decodePDFRawStream(xo).decode();
                const r = await zpracujProud(doc, data, res, mul(m, ctm), oblasti, cache, navstivene, pocty);
                if (r.pocet) {
                  pocet += r.pocet;
                  const novy = ctx.flateStream(r.bytes, { Subtype: 'Form' });
                  xo.dict.entries().forEach(([k, v]) => { if (k !== PDFName.of('Length') && k !== PDFName.of('Filter') && k !== PDFName.of('DecodeParms')) novy.dict.set(k, v); });
                  if (ref instanceof PDFRef) ctx.assign(ref, novy);
                }
              }
            }
          }
          break;
        }
        case 'Tj': case 'TJ': case "'": case '"': {
          if (op === "'" || op === '"') {
            if (op === '"') { Tw = cisla[0] || 0; Tc = cisla[1] || 0; }
            Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice();
          }
          const m = mul(Tm, ctm);
          const x = m[4], y = m[5];
          const f = font || { bajty: 1, w: () => 0.5 };
          // posun v textovém prostoru
          let posun = 0;
          const retezce = op === 'TJ' ? (prvniOperand && prvniOperand.typ === 'arr' ? prvniOperand.val : []) : operandy.filter((o) => o.typ === 'str');
          for (const el of retezce) {
            if (el.typ === 'str') posun += sirkaRetezce(el.val, f);
            else if (el.typ === 'num') posun += -el.val / 1000 * Tfs * Th;
          }
          const idx = vOblasti(oblasti, x, y);
          if (idx >= 0) {
            pocet++; pocty[idx]++;
            let text = '';
            if (op === '"') text = fmt(Tw) + ' Tw ' + fmt(Tc) + ' Tc T* ';
            else if (op === "'") text = 'T* ';
            if (Tfs * Th !== 0 && posun !== 0) text += '[ ' + fmt(-posun * 1000 / (Tfs * Th)) + ' ] TJ';
            zamena.push({ od: operandy.length ? operandy[0].od : t.od, do: t.do, text: text.trim() });
          }
          Tm = mul([1, 0, 0, 1, posun, 0], Tm);
          break;
        }
        default: break;
      }
      operandy = [];
    }

    if (!zamena.length) return { pocet: 0, bytes };
    const casti = []; let poz = 0;
    for (const z of zamena) { casti.push(bytes.subarray(poz, z.od)); casti.push(new TextEncoder().encode(' ' + z.text + ' ')); poz = z.do; }
    casti.push(bytes.subarray(poz));
    const delka = casti.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(delka); let o = 0;
    for (const c of casti) { out.set(c, o); o += c.length; }
    return { pocet, bytes: out };
  }

  /**
   * Odstraní textové operátory, které začínají v některé z oblastí.
   * Vrací pole – počet odstraněných operátorů pro každou oblast (ve stejném pořadí).
   * Volat PŘED kreslením nového obsahu (page.drawText apod.).
   */
  async function odstranText(doc, page, oblasti) {
    const ctx = doc.context;
    const node = page.node;
    const pocty = oblasti.map(() => 0);
    const contents = node.Contents();
    if (!contents) return pocty;
    const proudy = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
    const casti = [];
    for (const s of proudy) { if (s instanceof PDFStream) { casti.push(decodePDFRawStream(s).decode()); casti.push(new Uint8Array([10])); } }
    const delka = casti.reduce((a, c) => a + c.length, 0);
    const bytes = new Uint8Array(delka); let o = 0;
    for (const c of casti) { bytes.set(c, o); o += c.length; }

    const r = await zpracujProud(doc, bytes, node.Resources(), I, oblasti, new Map(), new Set(), pocty);
    if (r.pocet && r.bytes !== bytes) {
      const novy = ctx.flateStream(r.bytes);
      node.set(PDFName.of('Contents'), ctx.register(novy));
    }
    return pocty;
  }

  return { odstranText, tokenizuj };
})();
