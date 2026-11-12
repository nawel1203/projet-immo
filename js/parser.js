/* =====================================================================
 * Moteur de lecture des documents (factures, tickets, acomptes, devis)
 * Fonctions pures : aucune dépendance au navigateur (testables à part).
 * ===================================================================== */
(function (racine) {
  'use strict';

  const RAYONS = ['CONFORT & ENERGIE RENOUVELABLE', 'ELECTRICITE-PLOMBERIE', 'MATERIAUX DE CONSTRUCTION', 'SOL ET CARRELAGE MURAL',
    'RANGEMENT CUISINE', 'QUINCAILLERIE', 'MENUISERIE', 'PEINTURE', 'SANITAIRE', 'OUTILLAGE', 'ECLAIRAGE', 'DECORATION', 'JARDIN',
    'CUISINE', 'SALLE DE BAINS', 'CHAUFFAGE', 'ELECTRICITE', 'PLOMBERIE', 'EUR'];

  function arrondi(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function nombre(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).replace(/[\s  €]/g, '').replace(/EUR/i, '');
    // 1.234,56 → 1234.56 ; 1234,56 → 1234.56
    if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  function normaliser(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function lignesDe(texte) {
    return String(texte || '').replace(/[  ]/g, ' ').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim());
  }

  const MONTANT = '(-?\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}|-?\\d+[.,]\\d{2})';

  /** Dernière ligne qui correspond au libellé, puis montant sur la ligne ou juste en dessous. */
  function valeurApres(L, regex) {
    for (let i = L.length - 1; i >= 0; i--) {
      if (!regex.test(L[i])) continue;
      const m = L[i].match(new RegExp(MONTANT + '\\s*(?:€|EUR)?\\s*$'));
      if (m) return nombre(m[1]);
      for (let j = i + 1; j < Math.min(L.length, i + 4); j++) {
        const m2 = L[j].match(new RegExp('^' + MONTANT + '\\s*(?:€|EUR)?$'));
        if (m2) return nombre(m2[1]);
        if (L[j]) break;
      }
    }
    return null;
  }

  function lireDate(brut) {
    const m = brut.match(/Date (?:de vente|de facture|facture|d['’]émission|du devis)\s*:?\s*(\d{2})[\/.-](\d{2})[\/.-](\d{4})/i) ||
      brut.match(/\b(\d{2})[\/.](\d{2})[\/.](\d{4})\b/) ||
      brut.match(/\b(\d{2})[\/.](\d{2})[\/.](\d{2})\b/);
    if (!m) return '';
    const an = m[3].length === 2 ? '20' + m[3] : m[3];
    const j = Number(m[1]), mo = Number(m[2]);
    if (j < 1 || j > 31 || mo < 1 || mo > 12) return '';
    return an + '-' + m[2] + '-' + m[1];
  }

  function lireFournisseur(brut, L, nomFichier) {
    if (/leroy\s*merlin/i.test(brut)) {
      const m = brut.match(/leroy\s*merlin[ \t]+([A-Za-zÀ-ÿ'’ \-]+?)(?=[ \t]*(?:\d|,|\bavenue\b|\brue\b|\bzone\b|\bfacture\b|\n|$))/i);
      return 'Leroy Merlin' + (m && m[1].trim() ? ' ' + m[1].trim() : '');
    }
    const connus = ['Castorama', 'Brico Dépôt', 'Bricomarché', 'Mr Bricolage', 'IKEA', 'Conforama', 'But', 'Darty', 'Boulanger', 'Point P', 'Cedeo', 'Gedimat', 'Lapeyre', 'Weldom', 'Bricorama', 'Action', 'Maisons du Monde', 'Amazon'];
    for (const c of connus) {
      if (new RegExp('\\b' + c.replace(/ /g, '\\s*') + '\\b', 'i').test(brut)) return c;
    }
    const premiere = L.find(l => /[A-Za-zÀ-ÿ]{3}/.test(l) && !/^(facture|devis|ticket|date|page)/i.test(l));
    return (premiere || nomFichier || 'Fournisseur inconnu').slice(0, 40);
  }

  function nettoyerLibelle(l) {
    let s = String(l || '').replace(/\s+/g, ' ').trim();
    // retire les montants, quantités et « € » collés en fin de libellé (lecture PDF par colonnes)
    s = s.replace(/(\s+(-?\d+[.,]\d{2}\s*€?|\d{1,3}|€))+$/g, '').trim();
    let change = true;
    while (change) {
      change = false;
      for (const r of RAYONS) {
        if (s.toUpperCase().startsWith(r + ' ')) { s = s.slice(r.length).trim(); change = true; }
      }
    }
    return s;
  }

  function estLibelle(l) {
    return !!l && /[A-Za-z]/.test(l) && !/Tx TVA|^Dont |co-part|^Remise|^Total|^Page \d/i.test(l) && !/^[\d .,€]+$/.test(l);
  }
  function estFragment(l) { return estLibelle(l) && /\d/.test(l) && l.length <= 12 && !/€/.test(l); }

  /** Facture Leroy Merlin : prix payé par ligne = Montant HT + Montant TVA (remise déjà déduite). */
  function lignesFactureLM(L) {
    const res = [];
    for (let i = 0; i < L.length; i++) {
      if (!/Tx TVA/i.test(L[i])) continue;
      const tva = L[i].match(/Montant TVA\s*:\s*(-?\d+[.,]\d{2})/i);
      const ht = L[i].match(/Montant\s*HT\s*:\s*(-?\d+[.,]\d{2})/i);
      if (!tva || !ht) continue;
      const avant = L[i].split(/Tx TVA/i)[0].trim();
      let libelle;
      if (avant && estLibelle(avant)) {
        libelle = avant;
        if (estFragment(L[i - 1])) libelle = L[i - 1] + ' ' + libelle;
      } else {
        libelle = estLibelle(L[i - 1]) ? L[i - 1] : '';
        if (libelle && estFragment(L[i - 2])) libelle = L[i - 2] + ' ' + libelle;
      }
      res.push({ libelle: nettoyerLibelle(libelle) || 'Article (libellé illisible)', montant: arrondi(nombre(ht[1]) + nombre(tva[1])) });
    }
    return res;
  }

  /** Ticket de caisse : « LIBELLÉ  H 3343341176001 4.19 » (libellé parfois sur la ligne du dessus). */
  function lignesTicket(L) {
    const res = [];
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/^(.*?)\s*\bH\s+\d{8,14}\s+(-?\d+[.,]\d{2})\b/);
      if (!m) continue;
      let libelle = m[1].trim();
      if (!libelle && estLibelle(L[i - 1])) libelle = L[i - 1];
      res.push({ libelle: nettoyerLibelle(libelle) || 'Article (libellé illisible)', montant: nombre(m[2]) });
    }
    return res;
  }

  /**
   * Analyse un texte (issu d'un PDF ou d'un OCR) et renvoie une proposition à vérifier.
   * Rien n'est enregistré ici : l'application affiche l'écran de vérification.
   */
  function analyser(texte, nomFichier) {
    const brut = String(texte || '');
    const L = lignesDe(brut);
    const estLM = /leroy\s*merlin/i.test(brut);

    const mNum = brut.match(/FACTURE(?:\s+D['’]\s*ACOMPTE)?\s*N\s*[°o]\s*:?\s*([A-Z0-9-]{4,})/i) ||
      brut.match(/(?:DEVIS|FACTURE)\s*(?:N\s*[°o]|num[ée]ro)\s*:?\s*([A-Z0-9-]{3,})/i);
    const numero = mNum ? mNum[1] : '';

    let type = 'inconnu';
    if (/FACTURE\s+D['’]\s*ACOMPTE\s*N\s*[°o]/i.test(brut)) type = 'acompte';
    else if (/^\s*DEVIS\b|\bDEVIS\s*(N\s*[°o]|num)/im.test(brut) && !/\bFACTURE\s*N/i.test(brut)) type = 'devis';
    else if (/\bFACTURE\b/i.test(brut) && numero) type = estLM ? 'facture' : 'facture_artisan';
    else if (/TOTAL\s*\(EUR\)|TICKET CLIENT|\bH\s+\d{13}\s/i.test(brut)) type = 'ticket';
    else if (/\bFACTURE\b/i.test(brut)) type = 'facture_artisan';

    // Totaux : toujours le net payé, jamais le « sans remise ».
    let total = valeurApres(L, /^Total TTC\s*:?\s*(?:-?[\d ]+[.,]\d{2}\s*€?)?$/i);
    if (total === null) { const m = brut.match(/TOTAL\s*\(EUR\)\s*(-?\d+[.,]\d{2})/i); if (m) total = nombre(m[1]); }
    if (total === null) total = valeurApres(L, /(?:net|total|montant|reste)\s*(?:à|a)\s*payer/i);
    if (total === null) total = valeurApres(L, /^(?:total\s*(?:t\.?t\.?c\.?|ttc|g[ée]n[ée]ral)|montant\s*ttc)\b/i);
    if (total === null) total = valeurApres(L, /^MONTANT$/i);
    const remise = valeurApres(L, /^Total TTC remise\s*$/i) || 0;
    const ht = valeurApres(L, /^(?:total\s*h\.?t\.?|montant\s*h\.?t\.?)\b/i);
    const tva = valeurApres(L, /^(?:total\s*tva|montant\s*tva|tva)\b(?!.*%.*%)/i);
    const netAPayer = valeurApres(L, /(?:net|reste)\s*(?:à|a)\s*payer/i);
    const htOk = ht !== null && total !== null && ht <= total ? ht : null;
    const tvaOk = tva !== null && total !== null && tva < total * 0.25 ? tva : null;
    const tauxTVA = Array.from(new Set((brut.match(/\b(5[.,]5|10|20)[.,]?0{0,2}\s*%/g) || []).map(t => t.replace(/[^\d,.]/g, '').replace(',', '.').replace(/\.0+$/, ''))));

    // Acomptes cités par une facture finale (ex. « Facture d'acompte 0302526005224 »).
    const acomptesCites = [];
    const reA = /Facture d['’]acompte\s+(?:N\s*[°o]\s*)?(\d{6,})/gi;
    let ma;
    while ((ma = reA.exec(brut))) if (ma[1] !== numero && acomptesCites.indexOf(ma[1]) === -1) acomptesCites.push(ma[1]);

    let lignes = [];
    if (type === 'facture' || (estLM && type !== 'acompte' && type !== 'ticket')) lignes = lignesFactureLM(L);
    if (type === 'ticket') lignes = lignesTicket(L);
    if (!lignes.length && type !== 'acompte') lignes = lignesFactureLM(L);

    const somme = arrondi(lignes.reduce((s, a) => s + a.montant, 0));
    const controles = [];
    if (total === null) controles.push({ niveau: 'erreur', texte: 'Total non lu : à saisir.' });
    if (lignes.length && total !== null && Math.abs(somme - total) >= 0.01) controles.push({ niveau: 'alerte', texte: 'Les lignes font ' + somme.toFixed(2) + ' € pour un total de ' + total.toFixed(2) + ' €.' });
    if (htOk !== null && tvaOk !== null && total !== null && Math.abs(htOk + tvaOk - total) >= 0.02 && !remise) controles.push({ niveau: 'info', texte: 'HT + TVA ne donne pas exactement le TTC : à vérifier.' });

    return {
      type, numero, date: lireDate(brut), fournisseur: lireFournisseur(brut, L, nomFichier),
      total, remise, ht: htOk, tva: tvaOk, netAPayer: netAPayer !== null && total !== null && netAPayer < total - 0.01 ? netAPayer : null, tauxTVA, acomptesCites, lignes, sommeLignes: somme, controles
    };
  }

  /* -------------------- Classement -------------------- */

  function contientMot(texteNormalise, motCle) {
    return !!motCle && (' ' + texteNormalise).indexOf(' ' + normaliser(motCle)) !== -1;
  }

  function distance(a, b) { // Levenshtein (libellés courts)
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  /**
   * Propose un classement : 1) référence validée 2) article déjà classé (même libellé ou très proche) 3) règle 4) à classer.
   * memoire = [{cle, libelle, classement, valide}] ; regles = [{mot, categorie, enveloppe, posteNom, lotNom}]
   */
  function classer(libelle, memoire, regles) {
    const cle = normaliser(libelle);
    const ref = memoire.find(m => m.valide && m.cle === cle);
    if (ref) return { classement: Object.assign({}, ref.classement), origine: 'reference', libelleCorrige: null };
    const vu = memoire.find(m => m.cle === cle);
    if (vu) return { classement: Object.assign({}, vu.classement), origine: 'deja-vu', libelleCorrige: null };
    if (cle.length >= 8) { // libellé mal lu proche d'un article connu
      let meilleur = null, d = 99;
      memoire.forEach(m => { const x = distance(cle, m.cle); if (x < d) { d = x; meilleur = m; } });
      if (meilleur && d <= Math.max(1, Math.floor(cle.length * 0.08))) {
        return { classement: Object.assign({}, meilleur.classement), origine: 'proche', libelleCorrige: meilleur.libelle };
      }
    }
    const r = regles.find(x => contientMot(cle, x.mot));
    if (r) return { classement: { categorie: r.categorie || '', enveloppe: r.enveloppe || '', posteNom: r.posteNom || '', lotNom: r.lotNom || '' }, origine: 'regle', libelleCorrige: null };
    return { classement: { categorie: '', enveloppe: '', posteNom: '', lotNom: '' }, origine: 'aucune', libelleCorrige: null };
  }

  /** Doublon : même n° de document, ou même date + même total (hors documents non comptés). */
  function trouverDoublon(doc, documents) {
    return documents.find(d => d.id !== doc.id && d.compter !== false && (
      (doc.numero && d.numero && d.numero === doc.numero && d.type === doc.type) ||
      (doc.date && d.date === doc.date && doc.total != null && d.total != null && Math.abs(d.total - doc.total) < 0.01)
    )) || null;
  }

  const api = { analyser, classer, trouverDoublon, normaliser, nombre, arrondi, nettoyerLibelle, lignesDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.Lecteur = api;
})(typeof window !== 'undefined' ? window : this);
