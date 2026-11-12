/* =====================================================================
 * Suivi Projet Immo — V1 (stockage interne)
 * ===================================================================== */
(function () {
  'use strict';
  const D = window.Donnees, L = window.Lecteur;
  const { uid, arrondi } = D;
  const magasin = D.MagasinInterne;

  const CDN = {
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    ocr: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  };
  const COULEURS = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#6250d6', '#eda100', '#008300', '#e34948'];
  const TYPES = {
    facture: 'Facture magasin', ticket: 'Ticket de caisse', acompte: 'Facture d\'acompte',
    facture_artisan: 'Facture d\'artisan', devis: 'Devis', autre: 'Autre dépense', inconnu: 'Autre dépense'
  };
  const STATUTS = { 'a-faire': 'À faire', 'devis-demande': 'Devis demandé', 'devis-signe': 'Devis signé', 'en-cours': 'En cours', 'termine': 'Terminé' };
  const STATUTS_DEVIS = { recu: 'Reçu', signe: 'Signé', refuse: 'Refusé' };

  /* ---------------- Utilitaires ---------------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (n, d) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d }) + ' €';
  const pct = (a, b) => b > 0 ? Math.round(a / b * 100) + ' %' : '—';
  const dateFr = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const moisFr = cle => cle === 'sans date' ? 'sans date' : MOIS[Number(cle.slice(5, 7)) - 1] + ' ' + cle.slice(2, 4);
  const aujourdHui = () => new Date().toISOString().slice(0, 10);

  function toast(msg, duree) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('visible');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('visible'), duree || 2800);
  }
  function attente(msg) {
    const o = $('#attente');
    if (msg === false) { o.classList.remove('visible'); return; }
    o.querySelector('.msg').textContent = msg; o.classList.add('visible');
  }
  function chargerScript(url) {
    return new Promise((ok, ko) => {
      if (document.querySelector('script[src="' + url + '"]')) return ok();
      const s = document.createElement('script'); s.src = url; s.onload = ok;
      s.onerror = () => ko(new Error('Module indisponible (connexion internet nécessaire la première fois).'));
      document.head.appendChild(s);
    });
  }

  /* ---------------- État et persistance ---------------- */
  const S = { etat: null, projets: {}, brouillon: null, ouverts: {} };
  const ETAT_DEFAUT = { profils: [], profilId: null, reglages: { stockage: 'interne', validation: 'complete', rappelJours: 30, derniereSauvegarde: null }, ordre: [] };

  async function charger() {
    S.etat = (await magasin.lire('etat')) || JSON.parse(JSON.stringify(ETAT_DEFAUT));
    for (const id of S.etat.ordre) {
      const p = await magasin.lire('projet:' + id);
      if (p) { purgerCorbeille(p); S.projets[id] = p; }
    }
  }
  const sauverEtat = () => magasin.ecrire('etat', S.etat);
  const sauverProjet = p => { p.modifieLe = new Date().toISOString(); return magasin.ecrire('projet:' + p.id, p); };
  const profil = id => S.etat.profils.find(p => p.id === (id || S.etat.profilId)) || { nom: '?', couleur: '#9a998f' };

  function purgerCorbeille(p) {
    const limite = Date.now() - 30 * 864e5;
    p.corbeille = (p.corbeille || []).filter(x => Date.parse(x.supprimeLe) > limite);
  }

  /* ---------------- Classement ---------------- */
  function posteParNom(projet, env, nom, axe) {
    if (!nom) return null;
    const n = L.normaliser(nom);
    return projet.postes.find(p => p.env === env && L.normaliser(p.nom) === n && (!axe || p.axe === axe || (axe === 'piece' && !p.axe))) || null;
  }
  function proposerClassement(projet, libelle) {
    const r = L.classer(libelle, projet.memoire, projet.regles);
    if (r.origine === 'reference' || r.origine === 'deja-vu' || r.origine === 'proche') return { c: r.classement, origine: r.origine, libelleCorrige: r.libelleCorrige };
    if (r.origine === 'regle') {
      const env = r.classement.enveloppe && projet.enveloppes.indexOf(r.classement.enveloppe) !== -1 ? r.classement.enveloppe : '';
      const poste = env ? posteParNom(projet, env, r.classement.posteNom, env === 'travaux' ? 'piece' : null) : null;
      const lot = env === 'travaux' ? posteParNom(projet, 'travaux', r.classement.lotNom, 'lot') : null;
      return { c: { env, posteId: poste ? poste.id : '', lotId: lot ? lot.id : '', categorie: r.classement.categorie }, origine: 'regle' };
    }
    return { c: { env: '', posteId: '', lotId: '', categorie: '' }, origine: 'aucune' };
  }
  function memoriser(projet, l, valide) {
    if (D.ligneAClasser(projet, l)) return;
    const cle = L.normaliser(l.libelle);
    if (!cle) return;
    const c = { env: l.env, posteId: l.posteId || '', lotId: l.lotId || '', categorie: l.categorie || '' };
    const ex = projet.memoire.find(m => m.cle === cle);
    if (ex) { ex.classement = c; ex.libelle = l.libelle; if (valide) ex.valide = true; }
    else projet.memoire.push({ cle, libelle: l.libelle, classement: c, valide: !!valide });
  }

  /* ---------------- Lecture des fichiers ---------------- */
  async function textePDF(fichier) {
    await chargerScript(CDN.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const pdf = await window.pdfjsLib.getDocument({ data: await fichier.arrayBuffer() }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      const rangs = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5], x = it.transform[4];
        let r = rangs.find(z => Math.abs(z.y - y) < 2.5);
        if (!r) { r = { y, items: [] }; rangs.push(r); }
        r.items.push({ x, s: it.str });
      });
      rangs.sort((a, b) => b.y - a.y);
      pages.push(rangs.map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ')).join('\n'));
    }
    let texte = pages.join('\n');
    if (texte.replace(/\s/g, '').length < 60) { // PDF scanné : on lit l'image
      const morceaux = [];
      for (let n = 1; n <= Math.min(pdf.numPages, 3); n++) {
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        morceaux.push(await texteImage(c));
      }
      texte = morceaux.join('\n');
    }
    return texte;
  }

  /** Photo : réduction, niveaux de gris, contraste étiré (améliore nettement l'OCR). */
  async function preparerPhoto(fichier) {
    const img = await createImageBitmap(fichier);
    const max = 2000, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
    const jpeg = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
    const d = ctx.getImageData(0, 0, c.width, c.height), px = d.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < px.length; i += 4) { const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]); px[i] = g; hist[g]++; }
    const n = px.length / 4; let cum = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum > n * 0.01) { lo = v; break; } }
    cum = 0; for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum > n * 0.01) { hi = v; break; } }
    const e = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) { const g = Math.max(0, Math.min(255, (px[i] - lo) * e)); px[i] = px[i + 1] = px[i + 2] = g; }
    ctx.putImageData(d, 0, 0);
    return { canvas: c, jpeg };
  }

  async function texteImage(canvas) {
    await chargerScript(CDN.ocr);
    const r = await window.Tesseract.recognize(canvas, 'fra', {
      logger: m => { if (m.status === 'recognizing text') attente('Lecture de la photo… ' + Math.round(m.progress * 100) + ' %'); }
    });
    return r.data.text;
  }

  /* ---------------- Ajout d'un document ---------------- */
  async function traiterFichier(fichier, nature) {
    const projet = projetCourant();
    try {
      let texte = '', stocke = fichier;
      if (nature === 'photo') {
        attente('Préparation de la photo…');
        const prep = await preparerPhoto(fichier);
        stocke = new File([prep.jpeg], (fichier.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
        attente('Lecture de la photo… (la première fois, téléchargement du module de lecture)');
        texte = await texteImage(prep.canvas);
      } else {
        attente('Lecture du PDF…');
        texte = await textePDF(fichier);
      }
      attente(false);
      const a = L.analyser(texte, fichier.name);
      ouvrirRevue(projet, a, { blob: stocke, nom: stocke.name || fichier.name, type: stocke.type || fichier.type }, texte);
    } catch (e) {
      attente(false);
      console.error(e);
      toast('Lecture impossible : ' + e.message + ' Vous pouvez saisir la dépense à la main.', 6000);
      ouvrirRevue(projet, null, { blob: fichier, nom: fichier.name, type: fichier.type }, '');
    }
  }

  function ouvrirRevue(projet, a, fichier, texte, typeForce, artisanId) {
    const doc = {
      id: uid(), type: (a && a.type !== 'inconnu' ? a.type : (typeForce || 'autre')), date: (a && a.date) || aujourdHui(),
      fournisseur: (a && a.fournisseur) || '', numero: (a && a.numero) || '', total: a ? a.total : null, remise: (a && a.remise) || 0,
      netAPayer: a ? a.netAPayer : null, retenue: 0, acomptesCites: (a && a.acomptesCites) || [], compter: true, motif: '',
      artisanId: artisanId || '', devisId: '', auteurId: S.etat.profilId, creeLe: new Date().toISOString(), lignes: []
    };
    if (typeForce) doc.type = typeForce;
    if (a && a.lignes.length) {
      doc.lignes = a.lignes.map(x => {
        const p = proposerClassement(projet, x.libelle);
        return Object.assign({ id: uid(), libelle: p.libelleCorrige || x.libelle, montant: x.montant, origine: p.origine }, p.c);
      });
    } else if (doc.type !== 'devis') {
      doc.lignes = [Object.assign({ id: uid(), libelle: doc.fournisseur ? 'Achat ' + doc.fournisseur + ' (à détailler)' : 'Dépense (à détailler)', montant: doc.total || 0, origine: 'aucune' }, { env: '', posteId: '', lotId: '', categorie: '' })];
    }
    if (doc.type === 'facture_artisan' || doc.type === 'acompte' || doc.type === 'devis') {
      const art = projet.artisans.find(x => L.normaliser(x.nom) === L.normaliser(doc.fournisseur));
      if (art && !doc.artisanId) doc.artisanId = art.id;
    }
    const devisData = doc.type === 'devis' ? { statut: 'recu', env: 'travaux', posteId: '', lotId: '', objet: '' } : null;
    S.brouillon = { projetId: projet.id, doc, fichier, texte, controles: (a && a.controles) || [], devis: devisData, nouveau: true };
    calculerDoublon();
    // Validation automatique : chiffres justes et pas de doublon → enregistrement direct.
    if (S.etat.reglages.validation === 'automatique' && a && doc.type !== 'devis' && doc.total != null && a.lignes.length &&
      Math.abs(a.sommeLignes - doc.total) < 0.01 && !S.brouillon.doublon) {
      enregistrerBrouillon().then(() => toast('Enregistré automatiquement (' + euro(doc.total) + '). Les lignes non classées sont dans « À classer ».', 4500));
      return;
    }
    location.hash = '#/p/' + projet.id + '/revue';
  }

  function calculerDoublon() {
    const b = S.brouillon; if (!b) return;
    const projet = S.projets[b.projetId];
    b.doublon = b.doc.type === 'devis' ? null : L.trouverDoublon(b.doc, projet.documents);
    b.remplaceTicket = !!(b.doublon && b.doublon.type === 'ticket' && b.doc.type !== 'ticket');
    if (b.nouveau && b.doublon && !b.remplaceTicket && b.doc.compter !== false && !b.choixCompter) { b.doc.compter = false; b.doc.motif = 'Doublon probable'; }
  }

  async function enregistrerBrouillon() {
    const b = S.brouillon, projet = S.projets[b.projetId], doc = b.doc;
    doc.total = doc.total === '' || doc.total == null ? null : arrondi(doc.total);
    if (b.fichier && b.fichier.blob && !doc.fichierId) {
      doc.fichierId = uid();
      await magasin.ecrireFichier(doc.fichierId, { blob: b.fichier.blob, nom: b.fichier.nom, type: b.fichier.type });
    }
    if (doc.type === 'devis') {
      const dv = projet.devis.find(x => x.id === doc.id) || { id: doc.id };
      Object.assign(dv, { artisanId: doc.artisanId, numero: doc.numero, date: doc.date, fournisseur: doc.fournisseur, montantTTC: Number(doc.total) || 0,
        statut: b.devis.statut, env: b.devis.env, posteId: b.devis.posteId, lotId: b.devis.lotId, objet: b.devis.objet, fichierId: doc.fichierId, auteurId: doc.auteurId });
      if (!projet.devis.includes(dv)) projet.devis.push(dv);
    } else {
      doc.lignes = doc.lignes.filter(l => l.libelle || Number(l.montant));
      doc.lignes.forEach(l => { l.montant = arrondi(Number(l.montant) || 0); memoriser(projet, l, l.toujours); delete l.toujours; });
      if (b.remplaceTicket && b.doublon && doc.compter !== false) { b.doublon.compter = false; b.doublon.motif = 'Remplacé par la facture ' + (doc.numero || ''); }
      // Acomptes : comptés tant que la facture finale n'est pas là, puis « repris ».
      if (doc.type === 'facture' || doc.type === 'facture_artisan') {
        projet.documents.forEach(x => {
          if (x.type === 'acompte' && x.compter !== false && x.id !== doc.id &&
            ((x.numero && doc.acomptesCites.indexOf(x.numero) !== -1) || (doc.devisId && x.devisId === doc.devisId))) {
            x.compter = false; x.motif = 'Repris dans la facture ' + (doc.numero || 'finale');
          }
        });
      }
      if (doc.type === 'acompte') {
        const finale = projet.documents.find(x => (x.type === 'facture' || x.type === 'facture_artisan') && x.compter !== false &&
          ((doc.numero && (x.acomptesCites || []).indexOf(doc.numero) !== -1) || (doc.devisId && x.devisId === doc.devisId)));
        if (finale) { doc.compter = false; doc.motif = 'Repris dans la facture ' + (finale.numero || 'finale'); }
      }
      doc.modifieLe = new Date().toISOString(); doc.modifiePar = S.etat.profilId;
      const i = projet.documents.findIndex(x => x.id === doc.id);
      if (i === -1) projet.documents.push(doc); else projet.documents[i] = doc;
    }
    await sauverProjet(projet);
    S.brouillon = null;
    location.hash = '#/p/' + projet.id + (doc.type === 'devis' ? '/artisans' : '/documents');
  }

  /* ---------------- Rendu : routeur ---------------- */
  const projetCourant = () => S.projets[S.route.projetId];
  function lireRoute() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    if (h[0] === 'p' && h[1]) return { ecran: h[2] || 'tableau', projetId: h[1], arg: h[3] };
    return { ecran: h[0] || 'accueil' };
  }
  function rendre() {
    S.route = lireRoute();
    if (!S.etat.profils.length && S.route.ecran !== 'bienvenue') { location.hash = '#/bienvenue'; return; }
    if (S.route.projetId && !S.projets[S.route.projetId]) { location.hash = '#/accueil'; return; }
    const ecrans = { bienvenue: ecranBienvenue, accueil: ecranAccueil, nouveau: ecranNouveauProjet, reglages: ecranReglages,
      tableau: ecranTableau, documents: ecranDocuments, aclasser: ecranAClasser, budget: ecranBudget, artisans: ecranArtisans,
      artisan: ecranArtisan, revue: ecranRevue, regles: ecranRegles, corbeille: ecranCorbeille };
    const f = ecrans[S.route.ecran] || ecranAccueil;
    if (S.route.ecran === 'revue' && !S.brouillon) { location.hash = '#/p/' + S.route.projetId + '/documents'; return; }
    $('#app').innerHTML = f();
    window.scrollTo(0, 0);
  }

  function entete(titre, retour, droite) {
    return '<header class="entete">' + (retour ? '<a class="retour" href="' + retour + '" aria-label="Retour">‹</a>' : '<span></span>') +
      '<h1>' + esc(titre) + '</h1>' + (droite || '<span></span>') + '</header>';
  }
  function navProjet(p, actif) {
    const n = D.calculer(p).aClasser.nb;
    const it = (cle, ico, txt, badge) => '<a href="#/p/' + p.id + '/' + cle + '" class="' + (actif === cle ? 'actif' : '') + '"><span class="ico">' + ico + '</span>' + txt + (badge ? '<b class="badge">' + badge + '</b>' : '') + '</a>';
    return '<nav class="barre-nav">' + it('tableau', '📊', 'Tableau') + it('documents', '🧾', 'Documents') + it('aclasser', '🏷️', 'À classer', n) + it('budget', '💰', 'Budget') + it('artisans', '👷', 'Artisans') + '</nav>' +
      '<button class="fab" data-action="ajouter" aria-label="Ajouter un document">+</button>';
  }

  /* ---------------- Écran : bienvenue (premier lancement) ---------------- */
  function ecranBienvenue() {
    const etape = S.etapeBienvenue || 1;
    if (etape === 1) {
      return '<main class="page centre"><h1 class="grand">Bienvenue 👋</h1><p class="aide">Cette application suit le coût de votre projet immobilier : factures, devis, budget et avancement.</p>' +
        '<div class="carte"><h2>Votre profil</h2><label>Votre prénom<input id="b-nom" autocomplete="given-name" placeholder="ex. Nawel"></label>' +
        '<p class="note">Votre couleur (elle identifie vos ajouts quand le projet est partagé)</p><div class="couleurs">' +
        COULEURS.map((c, i) => '<button class="pastille' + (i === 0 ? ' choisie' : '') + '" style="background:' + c + '" data-action="choisir-couleur" data-couleur="' + c + '" aria-label="Couleur ' + (i + 1) + '"></button>').join('') +
        '</div></div><button class="principal" data-action="bienvenue-suite">Continuer</button></main>';
    }
    return '<main class="page centre"><h1 class="grand">Où garder vos projets ?</h1><p class="aide">Vous pourrez changer plus tard, dans les deux sens, sans rien perdre.</p>' +
      '<button class="choix choisi" data-action="stockage" data-valeur="interne"><b>📱 Sur ce téléphone</b><span>Simple, rien à connecter. Pensez à sauvegarder de temps en temps : un rappel vous préviendra.</span></button>' +
      '<button class="choix desactive" disabled><b>👥 Partagé <em class="bientot">bientôt (V1.1)</em></b><span>Dans un dossier Drive, pour travailler à plusieurs sur le même projet.</span></button>' +
      '<button class="principal" data-action="bienvenue-fin">Commencer</button></main>';
  }

  /* ---------------- Écran : accueil (liste des projets) ---------------- */
  function ecranAccueil() {
    const r = S.etat.reglages;
    const projets = S.etat.ordre.map(id => S.projets[id]).filter(Boolean);
    const nbDocs = projets.reduce((s, p) => s + p.documents.length, 0);
    const jours = r.derniereSauvegarde ? Math.floor((Date.now() - Date.parse(r.derniereSauvegarde)) / 864e5) : null;
    const rappel = nbDocs && (jours === null || jours >= r.rappelJours)
      ? '<div class="bandeau">💾 ' + (jours === null ? 'Aucune sauvegarde pour l\'instant.' : 'Dernière sauvegarde il y a ' + jours + ' jours.') + ' <button class="lien" data-action="sauvegarder">Sauvegarder maintenant</button></div>' : '';
    const cartes = projets.map(p => {
      const c = D.calculer(p);
      const larg = c.prevuTotal > 0 ? Math.min(100, c.total / c.prevuTotal * 100) : 0;
      return '<a class="carte projet" href="#/p/' + p.id + '/tableau"><div class="ligne-titre"><h2>' + esc(p.nom) + '</h2><span class="fleche">›</span></div>' +
        (p.adresse ? '<p class="note">' + esc(p.adresse) + '</p>' : '') +
        '<div class="chiffres-projet"><div><span class="label">Dépensé</span><b>' + euro(c.total, 0) + '</b></div><div><span class="label">Prévu</span><b>' + euro(c.prevuTotal, 0) + '</b></div><div><span class="label">À classer</span><b>' + c.aClasser.nb + '</b></div></div>' +
        '<div class="piste"><div class="rempli' + (c.total > c.prevuTotal && c.prevuTotal > 0 ? ' depasse' : '') + '" style="width:' + larg.toFixed(1) + '%"></div></div>' +
        '<p class="note">' + pct(c.total, c.prevuTotal) + ' du budget · ' + p.documents.length + ' document(s)</p></a>';
    }).join('');
    return entete('Mes projets', null, '<a class="icone" href="#/reglages" aria-label="Réglages">⚙️</a>') + '<main class="page">' + rappel +
      '<p class="sous-titre">Bonjour ' + esc(profil().nom) + ' <span class="pastille petite" style="background:' + profil().couleur + '"></span></p>' +
      (cartes || '<div class="vide-grand">Aucun projet pour l\'instant.</div>') +
      '<button class="principal" data-action="aller" data-cible="#/nouveau">+ Nouveau projet</button>' +
      '<button class="secondaire" data-action="importer">Importer un projet (fichier de sauvegarde)</button></main>';
  }

  /* ---------------- Écran : nouveau projet ---------------- */
  function ecranNouveauProjet() {
    return entete('Nouveau projet', '#/accueil') + '<main class="page"><div class="carte">' +
      '<label>Nom du projet<input id="np-nom" placeholder="ex. Appartement rue de Bordeaux"></label>' +
      '<label>Adresse (facultatif)<input id="np-adresse"></label></div>' +
      '<div class="carte"><h2>Ce que vous voulez suivre</h2><p class="note">Chaque enveloppe arrive avec des postes proposés, que vous pourrez modifier.</p>' +
      D.ENVELOPPES.map(e => '<label class="case"><input type="checkbox" class="np-env" value="' + e.cle + '" checked> ' + e.nom +
        '<span class="note">' + ({ acquisition: 'prix, notaire, agence, banque…', travaux: 'par pièce et par lot (plomberie, électricité…)', mobilier: 'par pièce : salon, chambre, cuisine…' })[e.cle] + '</span></label>').join('') +
      '</div><button class="principal" data-action="creer-projet">Créer le projet</button>' +
      '<p class="note centre">Ensuite, renseignez vos montants prévus dans l\'onglet Budget.</p></main>';
  }

  /* ---------------- Écran : tableau de bord ---------------- */
  function barre(prevu, depense, engage, opts) {
    opts = opts || {};
    const base = Math.max(prevu, depense + engage, 0.01);
    const wD = depense / base * 100, wE = engage / base * 100;
    const depasse = prevu > 0 && depense + engage > prevu;
    const tip = (opts.nom ? opts.nom + ' : ' : '') + euro(depense) + ' dépensés' + (engage ? ' + ' + euro(engage) + ' engagés' : '') + ' sur ' + euro(prevu) + ' prévus' + (prevu ? ' (' + pct(depense + engage, prevu) + ')' : '');
    return '<div class="barre' + (opts.grande ? ' grande' : '') + '" data-tip="' + esc(tip) + '"><div class="entete-barre"><span class="nom">' + esc(opts.nom || '') + '</span><span class="chiffres">' +
      euro(depense, 0) + (engage ? ' <span class="engage-txt">+ ' + euro(engage, 0) + '</span>' : '') + ' / ' + euro(prevu, 0) + '</span></div>' +
      '<div class="piste"><div class="rempli' + (depasse ? ' depasse' : '') + '" style="width:' + wD.toFixed(1) + '%"></div><div class="rempli engage" style="width:' + wE.toFixed(1) + '%"></div>' +
      (prevu > 0 && base > prevu ? '<div class="repere" style="left:' + (prevu / base * 100).toFixed(1) + '%"></div>' : '') + '</div>' +
      (depasse ? '<div class="etat depasse">⚠ Dépassement : ' + euro(depense + engage - prevu) + '</div>' : (prevu === 0 && depense > 0 ? '<div class="etat depasse">⚠ Aucun budget prévu</div>' : '')) + '</div>';
  }

  function ecranTableau() {
    const p = projetCourant(), c = D.calculer(p);
    const legende = '<p class="legende"><span class="cle depense"></span>Dépensé <span class="cle engage"></span>Engagé (devis signés) <span class="cle piste-cle"></span>Prévu</p>';
    let h = entete(p.nom, '#/accueil', '<button class="icone" data-action="menu-projet" aria-label="Menu du projet">⋯</button>') + '<main class="page avec-nav">';
    h += '<div class="tuiles"><div class="tuile"><span class="label">Dépensé</span><b>' + euro(c.total, 0) + '</b><span class="detail">' + pct(c.total, c.prevuTotal) + ' de ' + euro(c.prevuTotal, 0) + '</span></div>' +
      '<div class="tuile"><span class="label">Engagé</span><b>' + euro(c.engageTotal, 0) + '</b><span class="detail">devis signés à payer</span></div>' +
      '<div class="tuile"><span class="label">Disponible</span><b class="' + (c.disponible < 0 ? 'rouge' : '') + '">' + euro(c.disponible, 0) + '</b><span class="detail">prévu − dépensé − engagé</span></div>' +
      '<a class="tuile" href="#/p/' + p.id + '/aclasser"><span class="label">À classer</span><b>' + c.aClasser.nb + '</b><span class="detail">' + euro(c.aClasser.montant, 0) + '</span></a></div>';
    h += '<p class="controle">' + (c.controle.ok ? '✅ Documents et lignes concordent' : '⚠️ Écart de ' + euro(c.controle.ecart) + ' entre documents et lignes') +
      (c.retenue ? ' · Retenues de garantie dues : ' + euro(c.retenue) : '') + '</p>';
    if (!p.documents.length && !p.devis.length) h += '<div class="carte vide">Ajoutez votre premier document avec le bouton <b>+</b> en bas à droite.</div>';
    h += '<section class="carte"><h2>Enveloppes</h2>' + legende + c.enveloppes.map(e => barre(e.prevu, e.depense, e.engage, { nom: e.nom, grande: true })).join('') +
      (c.sansEnveloppe ? '<div class="etat depasse">⚠ ' + euro(c.sansEnveloppe) + ' sans enveloppe : à classer</div>' : '') + '</section>';
    c.enveloppes.forEach(e => {
      const axe = e.cle === 'travaux' ? (S.vueTravaux || p.axeTravaux) : null;
      const racines = c.postes.filter(x => x.env === e.cle && !x.parentId && (!axe || x.axe === axe));
      const actifs = racines.filter(x => x.depense || x.engage).sort((a, b) => (b.depense + b.engage) - (a.depense + a.engage));
      const vides = racines.filter(x => !x.depense && !x.engage);
      h += '<section class="carte"><div class="ligne-titre"><h2>' + e.nom + ' par ' + (e.cle === 'travaux' ? (axe === 'lot' ? 'lot' : 'pièce') : 'poste') + '</h2>' +
        (e.cle === 'travaux' ? '<div class="bascule"><button data-action="vue-travaux" data-valeur="piece" class="' + (axe === 'piece' ? 'on' : '') + '">Pièces</button><button data-action="vue-travaux" data-valeur="lot" class="' + (axe === 'lot' ? 'on' : '') + '">Lots</button></div>' : '') + '</div>' +
        (actifs.length ? actifs.map(x => barre(x.prevu, x.depense, x.engage, { nom: x.nom })).join('') : '<p class="note">Aucune dépense pour l\'instant.</p>') +
        (vides.length ? '<details><summary>' + vides.length + ' poste(s) sans dépense (' + euro(vides.reduce((s, x) => s + x.prevu, 0), 0) + ' prévus)</summary>' + vides.map(x => barre(x.prevu, 0, 0, { nom: x.nom })).join('') + '</details>' : '') + '</section>';
    });
    if (c.nbPieces) {
      const av = c.avancement, total = c.nbPieces;
      h += '<section class="carte"><h2>Avancement des travaux</h2><p class="note">' + (av.termine || 0) + ' sur ' + total + ' ' + (p.axeTravaux === 'lot' ? 'lots' : 'pièces') + ' terminé(e)s · statuts modifiables dans Budget</p><div class="pile">' +
        Object.keys(STATUTS).map((k, i) => av[k] ? '<div class="seg s' + i + '" style="flex:' + av[k] + '" data-tip="' + esc(STATUTS[k] + ' : ' + av[k]) + '"></div>' : '').join('') + '</div><p class="legende">' +
        Object.keys(STATUTS).map((k, i) => av[k] ? '<span class="cle s' + i + '"></span>' + STATUTS[k] + ' (' + av[k] + ') ' : '').join('') + '</p></section>';
    }
    if (c.categories.length) {
      const max = c.categories[0].montant || 1;
      h += '<section class="carte"><h2>Par type de dépense</h2>' + c.categories.slice(0, 9).map(k => '<div class="barre" data-tip="' + esc(k.nom + ' : ' + euro(k.montant) + ' (' + pct(k.montant, c.total) + ')') + '"><div class="entete-barre"><span class="nom">' + esc(k.nom) + '</span><span class="chiffres">' + euro(k.montant, 0) + '</span></div><div class="piste nue"><div class="rempli" style="width:' + (k.montant / max * 100).toFixed(1) + '%"></div></div></div>').join('') + '</section>';
    }
    if (c.mois.length) {
      const max = Math.max(...c.mois.map(m => m.montant)) || 1;
      h += '<section class="carte"><h2>Dépenses par mois</h2><div class="colonnes">' + c.mois.map(m => '<div class="col" data-tip="' + esc(moisFr(m.cle) + ' : ' + euro(m.montant)) + '"><span class="val">' + euro(m.montant, 0) + '</span><div class="baton" style="height:' + (m.montant / max * 100).toFixed(1) + '%"></div></div>').join('') + '</div><div class="etiquettes">' + c.mois.map(m => '<span>' + moisFr(m.cle) + '</span>').join('') + '</div></section>';
    }
    if (c.artisans.length) {
      h += '<section class="carte"><h2>Par artisan</h2>' + c.artisans.map(a => barre(a.paye + a.engage, a.paye, a.engage, { nom: a.nom })).join('') + '</section>';
    }
    return h + '</main>' + navProjet(p, 'tableau');
  }

  /* ---------------- Écran : documents ---------------- */
  function ecranDocuments() {
    const p = projetCourant();
    const docs = p.documents.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.creeLe || '').localeCompare(a.creeLe || ''));
    let h = entete('Documents', '#/p/' + p.id + '/tableau') + '<main class="page avec-nav">';
    if (!docs.length) h += '<div class="carte vide">Aucun document. Touchez <b>+</b> pour ajouter une photo, un PDF ou une saisie manuelle.</div>';
    let mois = '';
    docs.forEach(d => {
      const m = (d.date || '').slice(0, 7);
      if (m !== mois) { mois = m; h += '<h3 class="groupe">' + (m ? moisFr(m) : 'Sans date') + '</h3>'; }
      const nbAC = d.compter === false ? 0 : d.lignes.filter(l => D.ligneAClasser(p, l)).length;
      const auteur = profil(d.auteurId);
      h += '<button class="ligne-doc' + (d.compter === false ? ' barre-doc' : '') + '" data-action="ouvrir-doc" data-id="' + d.id + '" style="border-left-color:' + auteur.couleur + '">' +
        '<span class="doc-g"><b>' + esc(d.fournisseur || 'Sans fournisseur') + '</b><span class="note">' + dateFr(d.date) + ' · ' + TYPES[d.type] + (d.numero ? ' · n° ' + esc(d.numero) : '') + ' · ' + esc(auteur.nom) + '</span>' +
        (d.compter === false ? '<span class="pill gris">Non compté : ' + esc(d.motif || '') + '</span>' : '') + (nbAC ? '<span class="pill orange">' + nbAC + ' à classer</span>' : '') + '</span>' +
        '<span class="doc-d">' + euro(d.total) + '</span></button>';
    });
    if (p.corbeille && p.corbeille.length) h += '<p class="centre"><a class="lien" href="#/p/' + p.id + '/corbeille">Corbeille (' + p.corbeille.length + ')</a></p>';
    return h + '</main>' + navProjet(p, 'documents');
  }

  /* ---------------- Sélecteurs de classement ---------------- */
  function optionsPostes(p, env, axe, valeur) {
    const liste = p.postes.filter(x => x.env === env && (axe === 'lot' ? x.axe === 'lot' : x.axe !== 'lot'));
    const ligne = (x, niv) => '<option value="' + x.id + '"' + (x.id === valeur ? ' selected' : '') + '>' + (niv ? '— ' : '') + esc(x.nom) + '</option>' +
      liste.filter(y => y.parentId === x.id).map(y => ligne(y, niv + 1)).join('');
    return '<option value="">' + (axe === 'lot' ? 'Lot…' : (env === 'travaux' ? 'Pièce…' : 'Poste…')) + '</option>' + liste.filter(x => !x.parentId).map(x => ligne(x, 0)).join('') + '<option value="__nouveau">+ Nouveau…</option>';
  }
  function editeurClassement(p, l, prefixe) {
    const envs = D.ENVELOPPES.filter(e => p.enveloppes.indexOf(e.cle) !== -1);
    let h = '<div class="classement"><select data-change="' + prefixe + '-env" data-id="' + l.id + '"><option value="">Enveloppe…</option>' + envs.map(e => '<option value="' + e.cle + '"' + (l.env === e.cle ? ' selected' : '') + '>' + e.nom + '</option>').join('') + '</select>';
    if (l.env) {
      h += '<select data-change="' + prefixe + '-poste" data-id="' + l.id + '">' + optionsPostes(p, l.env, 'piece', l.posteId) + '</select>';
      if (l.env === 'travaux') h += '<select data-change="' + prefixe + '-lot" data-id="' + l.id + '">' + optionsPostes(p, 'travaux', 'lot', l.lotId) + '</select>';
    }
    h += '<input list="liste-categories" placeholder="Catégorie (ex. Peinture)" value="' + esc(l.categorie || '') + '" data-change="' + prefixe + '-cat" data-id="' + l.id + '"></div>';
    return h;
  }
  function resumeClassement(p, l) {
    const n = id => (p.postes.find(x => x.id === id) || {}).nom;
    const env = (D.ENVELOPPES.find(e => e.cle === l.env) || {}).nom;
    const parts = [env, n(l.posteId), n(l.lotId), l.categorie].filter(Boolean).filter((x, i, a) => a.findIndex(y => L.normaliser(y) === L.normaliser(x)) === i);
    return parts.length ? parts.join(' · ') : 'Non classé';
  }
  function datalistCategories(p) {
    const set = new Set(); p.regles.forEach(r => set.add(r.categorie)); p.documents.forEach(d => d.lignes.forEach(l => l.categorie && set.add(l.categorie)));
    return '<datalist id="liste-categories">' + Array.from(set).sort().map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>';
  }

  /* ---------------- Écran : vérification (revue) ---------------- */
  function ecranRevue() {
    const b = S.brouillon, p = S.projets[b.projetId], d = b.doc;
    const somme = arrondi(d.lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0));
    const reste = d.total != null && d.total !== '' ? arrondi(Number(d.total) - somme) : null;
    let h = entete(b.nouveau ? 'Vérifier le document' : 'Modifier le document', '#/p/' + p.id + '/documents') + '<main class="page">';
    if (b.fichier && b.fichier.blob) h += '<button class="lien-original" data-action="voir-original">📎 Voir l\'original (' + esc(b.fichier.nom || 'fichier') + ')</button>';
    else if (d.fichierId) h += '<button class="lien-original" data-action="voir-fichier" data-id="' + d.fichierId + '">📎 Voir l\'original</button>';
    const alertes = (b.controles || []).map(c => '<div class="alerte ' + c.niveau + '">' + esc(c.texte) + '</div>');
    if (b.doublon) {
      alertes.push(b.remplaceTicket
        ? '<div class="alerte info">Un ticket du ' + dateFr(b.doublon.date) + ' (' + euro(b.doublon.total) + ') correspond à cette facture : il sera marqué « non compté » et cette facture le remplace.</div>'
        : '<div class="alerte alerte">Doublon probable : « ' + esc(b.doublon.fournisseur) + ' » du ' + dateFr(b.doublon.date) + ', ' + euro(b.doublon.total) + '. Cette dépense ne sera pas comptée, sauf si vous cochez « Compter » ci-dessous.</div>');
    }
    h += alertes.join('');
    h += '<div class="carte"><label>Type<select data-change="r-type">' + ['facture', 'ticket', 'acompte', 'facture_artisan', 'devis', 'autre'].map(t => '<option value="' + t + '"' + (d.type === t || (t === 'autre' && d.type === 'inconnu') ? ' selected' : '') + '>' + TYPES[t] + '</option>').join('') + '</select></label>' +
      '<div class="deux"><label>Date<input type="date" value="' + esc(d.date) + '" data-change="r-champ" data-champ="date"></label><label>N°<input value="' + esc(d.numero) + '" data-change="r-champ" data-champ="numero"></label></div>' +
      '<label>' + (d.type === 'facture_artisan' || d.type === 'devis' || d.type === 'acompte' ? 'Artisan / fournisseur' : 'Fournisseur') + '<input value="' + esc(d.fournisseur) + '" data-change="r-champ" data-champ="fournisseur"></label>' +
      '<div class="deux"><label>' + (d.type === 'devis' ? 'Montant TTC du devis' : 'Total TTC payé') + '<input type="number" step="0.01" inputmode="decimal" value="' + (d.total == null ? '' : d.total) + '" data-change="r-champ" data-champ="total"></label>' +
      (d.remise ? '<label>Remise déduite<input disabled value="' + euro(d.remise) + '"></label>' : '') + '</div>';
    if (d.type === 'facture_artisan' || d.type === 'acompte' || d.type === 'devis') {
      h += '<label>Fiche artisan<select data-change="r-artisan"><option value="">— Aucune —</option>' + p.artisans.map(a => '<option value="' + a.id + '"' + (a.id === d.artisanId ? ' selected' : '') + '>' + esc(a.nom) + '</option>').join('') + '<option value="__nouveau">+ Créer « ' + esc(d.fournisseur || 'nouvel artisan') + ' »</option></select></label>';
      if (d.type !== 'devis' && d.artisanId) {
        const dvs = p.devis.filter(x => x.artisanId === d.artisanId);
        h += '<label>Devis concerné<select data-change="r-champ" data-champ="devisId"><option value="">— Aucun —</option>' + dvs.map(x => '<option value="' + x.id + '"' + (x.id === d.devisId ? ' selected' : '') + '>' + esc((x.numero || 'Devis') + ' · ' + euro(x.montantTTC) + ' · ' + STATUTS_DEVIS[x.statut]) + '</option>').join('') + '</select></label>';
      }
      if (d.type === 'facture_artisan') h += '<div class="deux"><label>Retenue de garantie<input type="number" step="0.01" value="' + (d.retenue || '') + '" data-change="r-champ" data-champ="retenue"></label>' + (d.netAPayer ? '<label>Net à payer lu<input disabled value="' + euro(d.netAPayer) + '"></label>' : '') + '</div>';
    }
    if (d.type !== 'devis') h += '<label class="case"><input type="checkbox" data-change="r-compter"' + (d.compter !== false ? ' checked' : '') + '> Compter cette dépense dans le budget' + (d.compter === false && d.motif ? ' <span class="note">(' + esc(d.motif) + ')</span>' : '') + '</label>';
    h += '</div>';

    if (d.type === 'devis') {
      const dv = b.devis;
      h += '<div class="carte"><h2>Devis</h2><label>Objet<input value="' + esc(dv.objet) + '" placeholder="ex. Mise aux normes électriques" data-change="r-devis" data-champ="objet"></label>' +
        '<label>Statut<select data-change="r-devis" data-champ="statut">' + Object.keys(STATUTS_DEVIS).map(k => '<option value="' + k + '"' + (dv.statut === k ? ' selected' : '') + '>' + STATUTS_DEVIS[k] + '</option>').join('') + '</select></label>' +
        '<p class="note">Un devis ne compte pas dans les dépenses. Signé, il apparaît en « engagé » sur le poste choisi.</p>' + editeurClassement(p, { id: 'devis', env: dv.env, posteId: dv.posteId, lotId: dv.lotId, categorie: '' }, 'rd').replace(/<input list[^>]*>/, '') + '</div>';
    } else {
      h += '<div class="carte"><div class="ligne-titre"><h2>Lignes (' + d.lignes.length + ')</h2>' + (reste !== null ? '<span class="' + (Math.abs(reste) < 0.01 ? 'ok' : 'rouge') + '">' + (Math.abs(reste) < 0.01 ? '✓ Total juste' : 'Reste à répartir : ' + euro(reste)) + '</span>' : '') + '</div>';
      d.lignes.forEach(l => {
        const ac = D.ligneAClasser(p, l);
        const ouvert = S.ouverts[l.id];
        h += '<div class="ligne-art' + (ac ? ' a-classer' : '') + '"><div class="deux etroit"><input class="libelle" value="' + esc(l.libelle) + '" data-change="r-ligne" data-champ="libelle" data-id="' + l.id + '"><input class="montant" type="number" step="0.01" inputmode="decimal" value="' + l.montant + '" data-change="r-ligne" data-champ="montant" data-id="' + l.id + '"></div>' +
          '<div class="ligne-bas"><button class="puce' + (ac ? ' orange' : '') + '" data-action="basculer-ligne" data-id="' + l.id + '">' + (ac ? '🏷️ ' : '') + esc(resumeClassement(p, l)) + (l.origine === 'deja-vu' || l.origine === 'reference' || l.origine === 'proche' ? ' · auto' : '') + '</button>' +
          '<button class="icone petit" data-action="suppr-ligne" data-id="' + l.id + '" aria-label="Supprimer la ligne">🗑</button></div>' +
          (ouvert ? editeurClassement(p, l, 'rl') + '<label class="case petit"><input type="checkbox" data-change="r-toujours" data-id="' + l.id + '"' + (l.toujours ? ' checked' : '') + '> Toujours classer cet article ainsi</label>' : '') + '</div>';
      });
      h += '<button class="secondaire" data-action="ajout-ligne">+ Ajouter une ligne</button></div>';
    }
    h += datalistCategories(p) + '<div class="actions-bas"><button class="principal" data-action="enregistrer">Enregistrer</button>' +
      (!b.nouveau ? '<button class="danger" data-action="supprimer-doc">Mettre à la corbeille</button>' : '') +
      '<button class="secondaire" data-action="annuler-revue">Annuler</button></div></main>';
    return h;
  }

  /* ---------------- Écran : à classer ---------------- */
  function ecranAClasser() {
    const p = projetCourant();
    const items = [];
    p.documents.forEach(d => { if (d.compter !== false) d.lignes.forEach(l => { if (D.ligneAClasser(p, l)) items.push({ d, l }); }); });
    let h = entete('À classer (' + items.length + ')', '#/p/' + p.id + '/tableau') + '<main class="page avec-nav">';
    if (!items.length) return h + '<div class="carte vide">✅ Tout est classé.</div></main>' + navProjet(p, 'aclasser');
    h += '<p class="aide">Choisissez où va chaque article. Cochez « toujours » pour que l\'application s\'en souvienne. Pour classer plusieurs lignes d\'un coup, cochez-les puis utilisez le bandeau du bas.</p>';
    items.forEach(({ d, l }) => {
      const sug = proposerClassement(p, l.libelle);
      const sugTxt = sug.origine !== 'aucune' && sug.c.env && !D.ligneAClasser(p, sug.c) ? resumeClassement(p, sug.c) : '';
      h += '<div class="carte serre"><div class="ligne-titre"><label class="case nu"><input type="checkbox" class="sel-ac" value="' + l.id + '"' + (S.selection && S.selection[l.id] ? ' checked' : '') + ' data-change="ac-sel"></label><b class="flex">' + esc(l.libelle) + '</b><b>' + euro(l.montant) + '</b></div>' +
        '<p class="note">' + esc(d.fournisseur) + ' · ' + dateFr(d.date) + ' · <span class="pastille petite" style="background:' + profil(d.auteurId).couleur + '"></span> ' + esc(profil(d.auteurId).nom) + '</p>' +
        (sugTxt ? '<button class="puce bleue" data-action="ac-suggestion" data-id="' + l.id + '">Suggestion : ' + esc(sugTxt) + '</button>' : '') +
        editeurClassement(p, l, 'ac') + '<label class="case petit"><input type="checkbox" data-change="ac-toujours" data-id="' + l.id + '"' + (l.toujours ? ' checked' : '') + '> Toujours classer cet article ainsi</label></div>';
    });
    const nSel = S.selection ? Object.keys(S.selection).filter(k => S.selection[k]).length : 0;
    if (nSel) {
      const g = S.groupe || { id: 'groupe', env: '', posteId: '', lotId: '', categorie: '' };
      h += '<div class="bandeau-bas"><b>' + nSel + ' ligne(s) sélectionnée(s)</b>' + editeurClassement(p, g, 'gr') + '<button class="principal" data-action="ac-groupe">Classer la sélection</button></div>';
    }
    return h + datalistCategories(p) + '</main>' + navProjet(p, 'aclasser');
  }
  function trouverLigne(p, id) {
    for (const d of p.documents) { const l = d.lignes.find(x => x.id === id); if (l) return { d, l }; }
    return null;
  }

  /* ---------------- Écran : budget ---------------- */
  function ecranBudget() {
    const p = projetCourant(), c = D.calculer(p);
    let h = entete('Budget', '#/p/' + p.id + '/tableau') + '<main class="page avec-nav"><p class="aide">Saisissez vos montants prévus. Un poste avec des sous-postes additionne ceux-ci. Touchez un nom pour le renommer.</p>';
    D.ENVELOPPES.forEach(e => {
      if (p.enveloppes.indexOf(e.cle) === -1) { h += '<button class="secondaire" data-action="ajout-env" data-env="' + e.cle + '">+ Suivre aussi l\'enveloppe ' + e.nom + '</button>'; return; }
      const ce = c.enveloppes.find(x => x.cle === e.cle);
      h += '<section class="carte"><div class="ligne-titre"><h2>' + e.nom + '</h2><b>' + euro(ce.prevu, 0) + '</b></div>';
      const bloc = axe => {
        const racines = p.postes.filter(x => x.env === e.cle && !x.parentId && (e.cle !== 'travaux' || x.axe === axe));
        const ligneP = (x, niv) => {
          const cx = c.postes.find(y => y.id === x.id);
          const enfants = p.postes.filter(y => y.parentId === x.id);
          const prevuMod = !enfants.length && (e.cle !== 'travaux' || axe === p.axeTravaux);
          return '<div class="poste niv' + niv + '"><div class="poste-ligne"><button class="nom-poste" data-action="renommer-poste" data-id="' + x.id + '">' + esc(x.nom) + '</button>' +
            (prevuMod ? '<input class="prevu" type="number" step="1" inputmode="decimal" value="' + (x.prevu || '') + '" placeholder="0" data-change="prevu" data-id="' + x.id + '">' : '<span class="prevu-calc">' + euro(cx.prevu, 0) + '</span>') + '</div>' +
            '<div class="poste-info"><span class="note">Dépensé ' + euro(cx.depense, 0) + (cx.engage ? ' · engagé ' + euro(cx.engage, 0) : '') + '</span>' +
            (e.cle === 'travaux' && !x.parentId ? '<select class="statut" data-change="statut" data-id="' + x.id + '">' + Object.keys(STATUTS).map(k => '<option value="' + k + '"' + (x.statut === k ? ' selected' : '') + '>' + STATUTS[k] + '</option>').join('') + '</select>' : '') +
            '<button class="lien petit" data-action="ajout-sous" data-id="' + x.id + '">+ sous-poste</button><button class="lien petit rouge" data-action="suppr-poste" data-id="' + x.id + '">supprimer</button></div></div>' +
            enfants.map(y => ligneP(y, niv + 1)).join('');
        };
        return racines.map(x => ligneP(x, 0)).join('') + '<button class="lien" data-action="ajout-poste" data-env="' + e.cle + '" data-axe="' + (axe || '') + '">+ Ajouter ' + (axe === 'lot' ? 'un lot' : axe === 'piece' ? 'une pièce' : 'un poste') + '</button>';
      };
      if (e.cle === 'travaux') {
        h += '<p class="note">Budget fixé par :</p><div class="bascule large"><button data-action="axe-travaux" data-valeur="piece" class="' + (p.axeTravaux === 'piece' ? 'on' : '') + '">Pièce</button><button data-action="axe-travaux" data-valeur="lot" class="' + (p.axeTravaux === 'lot' ? 'on' : '') + '">Lot (corps de métier)</button></div>' +
          '<p class="note">Chaque dépense de travaux peut porter une pièce et un lot : l\'autre axe reste suivi en dépenses.</p>' +
          '<h3>' + (p.axeTravaux === 'piece' ? 'Pièces' : 'Lots') + '</h3>' + bloc(p.axeTravaux) +
          '<details><summary>' + (p.axeTravaux === 'piece' ? 'Lots (suivi des dépenses)' : 'Pièces (suivi des dépenses)') + '</summary>' + bloc(p.axeTravaux === 'piece' ? 'lot' : 'piece') + '</details>';
      } else h += bloc(null);
      h += '</section>';
    });
    return h + '</main>' + navProjet(p, 'budget');
  }

  /* ---------------- Écran : artisans ---------------- */
  function ecranArtisans() {
    const p = projetCourant(), c = D.calculer(p);
    let h = entete('Artisans', '#/p/' + p.id + '/tableau') + '<main class="page avec-nav">';
    if (!p.artisans.length) h += '<div class="carte vide">Aucun artisan. Ajoutez-en un, ou enregistrez un devis : la fiche se crée depuis le devis.</div>';
    p.artisans.forEach(a => {
      const ca = c.artisans.find(x => x.id === a.id);
      h += '<a class="carte projet" href="#/p/' + p.id + '/artisan/' + a.id + '"><div class="ligne-titre"><h2>' + esc(a.nom) + '</h2><span class="fleche">›</span></div>' +
        '<div class="chiffres-projet"><div><span class="label">Payé</span><b>' + euro(ca.paye, 0) + '</b></div><div><span class="label">Reste à payer</span><b>' + euro(ca.engage, 0) + '</b></div><div><span class="label">Devis</span><b>' + ca.nbDevis + '</b></div></div>' +
        (ca.retenue ? '<p class="note">Retenue de garantie due : ' + euro(ca.retenue) + '</p>' : '') + '</a>';
    });
    return h + '<button class="principal" data-action="nouvel-artisan">+ Nouvel artisan</button></main>' + navProjet(p, 'artisans');
  }

  function ecranArtisan() {
    const p = projetCourant(), a = p.artisans.find(x => x.id === S.route.arg);
    if (!a) { location.hash = '#/p/' + p.id + '/artisans'; return ''; }
    const devis = p.devis.filter(x => x.artisanId === a.id), docs = p.documents.filter(x => x.artisanId === a.id);
    let h = entete(a.nom, '#/p/' + p.id + '/artisans') + '<main class="page"><div class="carte">' +
      ['nom', 'telephone', 'email', 'siret'].map(k => '<label>' + ({ nom: 'Nom', telephone: 'Téléphone', email: 'E-mail', siret: 'SIRET' })[k] + '<input value="' + esc(a[k] || '') + '" data-change="artisan" data-champ="' + k + '"></label>').join('') + '</div>';
    h += '<section class="carte"><div class="ligne-titre"><h2>Devis</h2><button class="lien" data-action="devis-manuel" data-id="' + a.id + '">+ Devis</button></div>';
    if (!devis.length) h += '<p class="note">Aucun devis.</p>';
    devis.forEach(dv => {
      const eng = D.engageRestant(p, dv);
      h += '<div class="devis"><div class="ligne-titre"><b>' + esc(dv.objet || dv.numero || 'Devis') + '</b><b>' + euro(dv.montantTTC) + '</b></div><p class="note">' + dateFr(dv.date) + (dv.numero ? ' · n° ' + esc(dv.numero) : '') + ' · ' + esc(resumeClassement(p, dv)) + '</p>' +
        '<div class="poste-info"><select data-change="statut-devis" data-id="' + dv.id + '">' + Object.keys(STATUTS_DEVIS).map(k => '<option value="' + k + '"' + (dv.statut === k ? ' selected' : '') + '>' + STATUTS_DEVIS[k] + '</option>').join('') + '</select>' +
        (dv.statut === 'signe' ? '<span class="note">Reste à facturer : ' + euro(eng) + '</span>' : '') + (dv.fichierId ? '<button class="lien petit" data-action="voir-fichier" data-id="' + dv.fichierId + '">original</button>' : '') + '<button class="lien petit" data-action="modifier-devis" data-id="' + dv.id + '">modifier</button></div></div>';
    });
    h += '</section><section class="carte"><h2>Factures et paiements</h2>' + (docs.length ? docs.map(d => '<button class="ligne-doc' + (d.compter === false ? ' barre-doc' : '') + '" data-action="ouvrir-doc" data-id="' + d.id + '"><span class="doc-g"><b>' + TYPES[d.type] + '</b><span class="note">' + dateFr(d.date) + (d.numero ? ' · n° ' + esc(d.numero) : '') + (d.compter === false ? ' · ' + esc(d.motif) : '') + '</span></span><span class="doc-d">' + euro(d.total) + '</span></button>').join('') : '<p class="note">Aucune facture.</p>') + '</section>';
    return h + '<button class="danger" data-action="suppr-artisan" data-id="' + a.id + '">Supprimer la fiche</button></main>';
  }

  /* ---------------- Écran : règles ---------------- */
  function ecranRegles() {
    const p = projetCourant();
    let h = entete('Règles de classement', '#/p/' + p.id + '/tableau') + '<main class="page"><p class="aide">Si le libellé d\'un article contient un mot commençant par le mot-clé, l\'application propose ce classement. Vos propres classements passent toujours avant.</p>';
    p.regles.forEach((r, i) => {
      h += '<div class="carte serre"><div class="deux"><label>Mot-clé<input value="' + esc(r.mot) + '" data-change="regle" data-i="' + i + '" data-champ="mot"></label><label>Catégorie<input value="' + esc(r.categorie) + '" data-change="regle" data-i="' + i + '" data-champ="categorie"></label></div>' +
        '<div class="deux"><label>Enveloppe<select data-change="regle" data-i="' + i + '" data-champ="enveloppe"><option value="">—</option>' + D.ENVELOPPES.map(e => '<option value="' + e.cle + '"' + (r.enveloppe === e.cle ? ' selected' : '') + '>' + e.nom + '</option>').join('') + '</select></label>' +
        '<label>Pièce / poste<input value="' + esc(r.posteNom) + '" data-change="regle" data-i="' + i + '" data-champ="posteNom"></label></div>' +
        (r.enveloppe === 'travaux' ? '<label>Lot<input value="' + esc(r.lotNom) + '" data-change="regle" data-i="' + i + '" data-champ="lotNom"></label>' : '') +
        '<button class="lien petit rouge" data-action="suppr-regle" data-i="' + i + '">supprimer</button></div>';
    });
    return h + '<button class="principal" data-action="ajout-regle">+ Ajouter une règle</button></main>';
  }

  function ecranCorbeille() {
    const p = projetCourant();
    let h = entete('Corbeille', '#/p/' + p.id + '/documents') + '<main class="page"><p class="aide">Les documents restent ici 30 jours avant d\'être effacés.</p>';
    (p.corbeille || []).forEach(x => {
      h += '<div class="ligne-doc"><span class="doc-g"><b>' + esc(x.doc.fournisseur) + '</b><span class="note">' + dateFr(x.doc.date) + ' · supprimé le ' + dateFr(x.supprimeLe.slice(0, 10)) + '</span></span><button class="lien" data-action="restaurer-doc" data-id="' + x.doc.id + '">Restaurer</button></div>';
    });
    return h + '</main>';
  }

  /* ---------------- Écran : réglages ---------------- */
  function ecranReglages() {
    const r = S.etat.reglages, moi = profil();
    let h = entete('Réglages', '#/accueil') + '<main class="page">';
    h += '<section class="carte"><h2>Profil</h2><label>Prénom<input value="' + esc(moi.nom) + '" data-change="profil-nom"></label><div class="couleurs">' +
      COULEURS.map(c => '<button class="pastille' + (c === moi.couleur ? ' choisie' : '') + '" style="background:' + c + '" data-action="profil-couleur" data-couleur="' + c + '"></button>').join('') + '</div>' +
      (S.etat.profils.length > 1 ? '<label>Profil utilisé sur ce téléphone<select data-change="profil-actif">' + S.etat.profils.map(x => '<option value="' + x.id + '"' + (x.id === S.etat.profilId ? ' selected' : '') + '>' + esc(x.nom) + '</option>').join('') + '</select></label>' : '') +
      '<button class="lien" data-action="nouveau-profil">+ Ajouter un profil</button></section>';
    h += '<section class="carte"><h2>Validation des documents</h2>' +
      '<label class="case"><input type="radio" name="val" value="complete" data-change="validation"' + (r.validation === 'complete' ? ' checked' : '') + '> <span><b>Complète</b><span class="note">Vous relisez chaque document avant enregistrement.</span></span></label>' +
      '<label class="case"><input type="radio" name="val" value="automatique" data-change="validation"' + (r.validation === 'automatique' ? ' checked' : '') + '> <span><b>Automatique</b><span class="note">Enregistré seul quand les chiffres tombent juste ; vous ne voyez que les cas douteux et les lignes à classer.</span></span></label></section>';
    h += '<section class="carte"><h2>Stockage</h2><label class="case"><input type="radio" checked disabled> <span><b>📱 Sur ce téléphone</b></span></label><label class="case desactive"><input type="radio" disabled> <span><b>👥 Partagé (dossier Drive)</b><span class="note">Disponible en V1.1 : vos données seront transférées sans rien ressaisir.</span></span></label></section>';
    h += '<section class="carte"><h2>Sauvegarde</h2><p class="note">' + (r.derniereSauvegarde ? 'Dernière sauvegarde : ' + dateFr(r.derniereSauvegarde.slice(0, 10)) : 'Jamais sauvegardé.') + '</p>' +
      '<button class="principal" data-action="sauvegarder">💾 Sauvegarder (fichier)</button><button class="secondaire" data-action="importer">Restaurer / importer un fichier</button>' +
      '<label>Rappel si pas de sauvegarde depuis (jours)<input type="number" min="1" value="' + r.rappelJours + '" data-change="rappel"></label></section>';
    h += '<p class="note centre">Suivi Projet Immo · V1 · données stockées uniquement sur ce téléphone</p></main>';
    return h;
  }

  /* ---------------- Feuille d'ajout et menu ---------------- */
  function feuille(html) {
    const f = $('#feuille');
    f.innerHTML = '<div class="voile" data-action="fermer-feuille"></div><div class="panneau">' + html + '</div>';
    f.classList.add('visible');
  }
  const fermerFeuille = () => $('#feuille').classList.remove('visible');

  /* ---------------- Sauvegarde / restauration / export ---------------- */
  const blobEnBase64 = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  async function base64EnBlob(url) { return (await fetch(url)).blob(); }

  async function sauvegarder() {
    attente('Préparation de la sauvegarde…');
    const fichiers = {};
    for (const id of await magasin.clesFichiers()) {
      const f = await magasin.lireFichier(id);
      if (f) fichiers[id] = { nom: f.nom, type: f.type, data: await blobEnBase64(f.blob) };
    }
    const contenu = { format: 'suivi-projet-immo', version: 1, creeLe: new Date().toISOString(), profils: S.etat.profils, projets: S.etat.ordre.map(id => S.projets[id]), fichiers };
    const blob = new Blob([JSON.stringify(contenu)], { type: 'application/json' });
    telecharger(blob, 'sauvegarde-projets-' + aujourdHui() + '.json');
    S.etat.reglages.derniereSauvegarde = new Date().toISOString();
    await sauverEtat();
    attente(false);
    toast('Sauvegarde créée. Rangez ce fichier en lieu sûr (e-mail, Drive, ordinateur).', 5000);
    rendre();
  }
  function telecharger(blob, nom) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function importer(fichier) {
    try {
      const c = JSON.parse(await fichier.text());
      if (c.format !== 'suivi-projet-immo') throw new Error('Ce fichier n\'est pas une sauvegarde de l\'application.');
      let n = 0;
      for (const p of c.projets) {
        if (S.projets[p.id] && !confirm('Le projet « ' + p.nom + ' » existe déjà sur ce téléphone. Le remplacer par la version du fichier ?')) continue;
        S.projets[p.id] = p; if (S.etat.ordre.indexOf(p.id) === -1) S.etat.ordre.push(p.id);
        await magasin.ecrire('projet:' + p.id, p); n++;
      }
      (c.profils || []).forEach(pr => { if (!S.etat.profils.find(x => x.id === pr.id)) S.etat.profils.push(pr); });
      for (const id of Object.keys(c.fichiers || {})) {
        const f = c.fichiers[id];
        await magasin.ecrireFichier(id, { blob: await base64EnBlob(f.data), nom: f.nom, type: f.type });
      }
      await sauverEtat();
      toast(n + ' projet(s) importé(s).');
      location.hash = '#/accueil'; rendre();
    } catch (e) { toast('Import impossible : ' + e.message, 5000); }
  }
  async function exporterExcel(p) {
    const docs = p.documents.map(d => ({ Date: d.date, Type: TYPES[d.type], Fournisseur: d.fournisseur, 'N°': d.numero, 'Total TTC': d.total, Remise: d.remise || 0, Compté: d.compter === false ? 'non' : 'oui', Motif: d.motif || '', Auteur: profil(d.auteurId).nom }));
    const nomP = id => (p.postes.find(x => x.id === id) || {}).nom || '';
    const lignes = []; p.documents.forEach(d => d.lignes.forEach(l => lignes.push({ Date: d.date, Fournisseur: d.fournisseur, 'N°': d.numero, Article: l.libelle, 'Montant TTC': l.montant, Enveloppe: (D.ENVELOPPES.find(e => e.cle === l.env) || {}).nom || '', 'Pièce / poste': nomP(l.posteId), Lot: nomP(l.lotId), Catégorie: l.categorie || '', Compté: d.compter === false ? 'non' : 'oui' })));
    const c = D.calculer(p);
    const budget = c.postes.map(x => ({ Enveloppe: (D.ENVELOPPES.find(e => e.cle === x.env) || {}).nom, Poste: x.nom, Parent: nomP(x.parentId), Axe: x.axe || '', Prévu: x.prevu, Dépensé: x.depense, Engagé: x.engage }));
    const devis = p.devis.map(dv => ({ Date: dv.date, Artisan: (p.artisans.find(a => a.id === dv.artisanId) || {}).nom || dv.fournisseur, Objet: dv.objet, 'N°': dv.numero, 'Montant TTC': dv.montantTTC, Statut: STATUTS_DEVIS[dv.statut], 'Reste à facturer': D.engageRestant(p, dv) }));
    try {
      await chargerScript(CDN.xlsx);
      const X = window.XLSX, wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(docs), 'Documents');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(lignes), 'Lignes');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(budget), 'Budget');
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(devis), 'Devis');
      X.writeFile(wb, p.nom.replace(/[^\w\- ]+/g, '') + ' ' + aujourdHui() + '.xlsx');
    } catch (e) {
      const csv = [Object.keys(lignes[0] || { Article: '' }).join(';')].concat(lignes.map(l => Object.values(l).map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'))).join('\n');
      telecharger(new Blob(['﻿' + csv], { type: 'text/csv' }), p.nom + ' lignes.csv');
      toast('Excel indisponible hors connexion : export en CSV.', 4000);
    }
  }

  /* ---------------- Actions (clics) ---------------- */
  function demanderNomPoste(p, env, axe, parentId) {
    const nom = prompt(axe === 'lot' ? 'Nom du nouveau lot' : (env === 'travaux' ? 'Nom de la nouvelle pièce' : 'Nom du nouveau poste'));
    if (!nom || !nom.trim()) return null;
    const x = { id: uid(), env, nom: nom.trim(), parentId: parentId || null, axe: env === 'travaux' && !parentId ? (axe || 'piece') : (parentId ? (p.postes.find(y => y.id === parentId) || {}).axe || null : null), prevu: 0, statut: 'a-faire' };
    p.postes.push(x); return x;
  }

  const actions = {
    'aller': el => { location.hash = el.dataset.cible; },
    'choisir-couleur': el => { document.querySelectorAll('.pastille').forEach(x => x.classList.remove('choisie')); el.classList.add('choisie'); S.couleurBienvenue = el.dataset.couleur; },
    'bienvenue-suite': () => {
      const nom = $('#b-nom').value.trim();
      if (!nom) { toast('Indiquez votre prénom.'); return; }
      S.nomBienvenue = nom; S.etapeBienvenue = 2; rendre();
    },
    'bienvenue-fin': async () => {
      const pr = { id: uid(), nom: S.nomBienvenue, couleur: S.couleurBienvenue || COULEURS[0] };
      S.etat.profils.push(pr); S.etat.profilId = pr.id; S.etat.reglages.stockage = 'interne';
      await sauverEtat(); location.hash = '#/accueil';
    },
    'creer-projet': async () => {
      const nom = $('#np-nom').value.trim();
      if (!nom) { toast('Donnez un nom au projet.'); return; }
      const envs = Array.from(document.querySelectorAll('.np-env:checked')).map(x => x.value);
      if (!envs.length) { toast('Choisissez au moins une enveloppe.'); return; }
      const p = D.nouveauProjet(nom, $('#np-adresse').value.trim(), envs, S.etat.profilId);
      S.projets[p.id] = p; S.etat.ordre.push(p.id);
      await sauverProjet(p); await sauverEtat();
      location.hash = '#/p/' + p.id + '/budget';
      toast('Projet créé. Renseignez vos montants prévus.');
    },
    'ajouter': () => feuille('<h2>Ajouter</h2>' +
      '<label class="gros-bouton">📷 Photo d\'une facture ou d\'un ticket<input type="file" accept="image/*" capture="environment" data-change="fichier" data-nature="photo"></label>' +
      '<label class="gros-bouton">📄 PDF (facture reçue par e-mail, devis…)<input type="file" accept="application/pdf" data-change="fichier" data-nature="pdf"></label>' +
      '<button class="gros-bouton" data-action="saisie-manuelle">✍️ Saisie manuelle (sans document, ou si la lecture échoue)</button>' +
      '<button class="gros-bouton" data-action="devis-manuel">📝 Devis saisi à la main</button>' +
      '<button class="secondaire" data-action="fermer-feuille">Annuler</button>'),
    'fermer-feuille': fermerFeuille,
    'saisie-manuelle': () => { fermerFeuille(); ouvrirRevue(projetCourant(), null, null, '', 'autre'); },
    'devis-manuel': el => { fermerFeuille(); ouvrirRevue(projetCourant(), null, null, '', 'devis', el.dataset.id || ''); },
    'voir-original': () => { const f = S.brouillon.fichier; window.open(URL.createObjectURL(f.blob), '_blank'); },
    'voir-fichier': async el => { const f = await magasin.lireFichier(el.dataset.id); if (f) window.open(URL.createObjectURL(f.blob), '_blank'); else toast('Original introuvable.'); },
    'basculer-ligne': el => { S.ouverts[el.dataset.id] = !S.ouverts[el.dataset.id]; rendre(); },
    'suppr-ligne': el => { const d = S.brouillon.doc; d.lignes = d.lignes.filter(l => l.id !== el.dataset.id); rendre(); },
    'ajout-ligne': () => {
      const d = S.brouillon.doc;
      const somme = d.lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);
      const l = { id: uid(), libelle: '', montant: d.total != null ? arrondi(Math.max(0, Number(d.total) - somme)) : 0, env: '', posteId: '', lotId: '', categorie: '', origine: 'manuel' };
      d.lignes.push(l); S.ouverts[l.id] = true; rendre();
    },
    'enregistrer': async () => {
      const b = S.brouillon, d = b.doc;
      if (d.total == null || d.total === '' || isNaN(Number(d.total))) { toast('Indiquez le total.'); return; }
      if (d.type === 'devis' && !d.artisanId) {
        if (!d.fournisseur) { toast('Indiquez l\'artisan.'); return; }
        const p = S.projets[b.projetId]; const a = { id: uid(), nom: d.fournisseur }; p.artisans.push(a); d.artisanId = a.id;
      }
      await enregistrerBrouillon(); toast('Enregistré.');
    },
    'annuler-revue': () => { const id = S.brouillon.projetId; S.brouillon = null; location.hash = '#/p/' + id + '/documents'; },
    'supprimer-doc': async () => {
      if (!confirm('Mettre ce document à la corbeille ? Il reste récupérable 30 jours.')) return;
      const b = S.brouillon, p = S.projets[b.projetId];
      p.documents = p.documents.filter(x => x.id !== b.doc.id);
      p.corbeille.push({ doc: b.doc, supprimeLe: new Date().toISOString() });
      await sauverProjet(p); S.brouillon = null; location.hash = '#/p/' + p.id + '/documents'; toast('Document mis à la corbeille.');
    },
    'restaurer-doc': async el => {
      const p = projetCourant(), i = p.corbeille.findIndex(x => x.doc.id === el.dataset.id);
      if (i === -1) return;
      p.documents.push(p.corbeille[i].doc); p.corbeille.splice(i, 1); await sauverProjet(p); rendre(); toast('Document restauré.');
    },
    'ouvrir-doc': el => {
      const p = projetCourant(), d = p.documents.find(x => x.id === el.dataset.id);
      S.brouillon = { projetId: p.id, doc: JSON.parse(JSON.stringify(d)), fichier: null, controles: [], nouveau: false };
      location.hash = '#/p/' + p.id + '/revue';
    },
    'modifier-devis': el => {
      const p = projetCourant(), dv = p.devis.find(x => x.id === el.dataset.id);
      S.brouillon = { projetId: p.id, nouveau: false, fichier: null, controles: [], devis: { statut: dv.statut, env: dv.env, posteId: dv.posteId, lotId: dv.lotId, objet: dv.objet || '' },
        doc: { id: dv.id, type: 'devis', date: dv.date, fournisseur: dv.fournisseur || '', numero: dv.numero || '', total: dv.montantTTC, artisanId: dv.artisanId, fichierId: dv.fichierId, lignes: [], acomptesCites: [] } };
      location.hash = '#/p/' + p.id + '/revue';
    },
    'ac-suggestion': async el => {
      const p = projetCourant(), t = trouverLigne(p, el.dataset.id);
      Object.assign(t.l, proposerClassement(p, t.l.libelle).c); memoriser(p, t.l, t.l.toujours); await sauverProjet(p); rendre();
    },
    'ac-groupe': async () => {
      const p = projetCourant(), g = S.groupe || {};
      if (!g.env) { toast('Choisissez au moins l\'enveloppe.'); return; }
      Object.keys(S.selection).filter(k => S.selection[k]).forEach(id => { const t = trouverLigne(p, id); if (t) { Object.assign(t.l, { env: g.env, posteId: g.posteId || '', lotId: g.lotId || '', categorie: g.categorie || t.l.categorie }); memoriser(p, t.l, false); } });
      S.selection = {}; S.groupe = null; await sauverProjet(p); rendre(); toast('Sélection classée.');
    },
    'vue-travaux': el => { S.vueTravaux = el.dataset.valeur; rendre(); },
    'axe-travaux': async el => { const p = projetCourant(); p.axeTravaux = el.dataset.valeur; S.vueTravaux = null; await sauverProjet(p); rendre(); },
    'ajout-env': async el => {
      const p = projetCourant(), modele = D.nouveauProjet('x', '', [el.dataset.env], '');
      p.enveloppes.push(el.dataset.env); p.postes.push(...modele.postes); await sauverProjet(p); rendre();
    },
    'renommer-poste': async el => {
      const p = projetCourant(), x = p.postes.find(y => y.id === el.dataset.id);
      const nom = prompt('Nouveau nom', x.nom); if (!nom || !nom.trim()) return;
      x.nom = nom.trim(); await sauverProjet(p); rendre();
    },
    'ajout-poste': async el => { const p = projetCourant(); if (demanderNomPoste(p, el.dataset.env, el.dataset.axe || null, null)) { await sauverProjet(p); rendre(); } },
    'ajout-sous': async el => { const p = projetCourant(), x = p.postes.find(y => y.id === el.dataset.id); if (demanderNomPoste(p, x.env, x.axe, x.id)) { await sauverProjet(p); rendre(); } },
    'suppr-poste': async el => {
      const p = projetCourant(), x = p.postes.find(y => y.id === el.dataset.id), ids = D.descendants(p, x.id);
      let n = 0; p.documents.forEach(d => d.lignes.forEach(l => { if (ids.indexOf(l.posteId) !== -1 || ids.indexOf(l.lotId) !== -1) n++; }));
      if (!confirm('Supprimer « ' + x.nom + ' »' + (ids.length > 1 ? ' et ses sous-postes' : '') + ' ?' + (n ? '\n' + n + ' ligne(s) classée(s) ici repasseront « à classer » (rien n\'est perdu).' : ''))) return;
      p.documents.forEach(d => d.lignes.forEach(l => { if (ids.indexOf(l.posteId) !== -1) l.posteId = ''; if (ids.indexOf(l.lotId) !== -1) l.lotId = ''; }));
      p.memoire.forEach(m => { if (ids.indexOf(m.classement.posteId) !== -1) m.classement.posteId = ''; if (ids.indexOf(m.classement.lotId) !== -1) m.classement.lotId = ''; });
      p.postes = p.postes.filter(y => ids.indexOf(y.id) === -1); await sauverProjet(p); rendre();
    },
    'nouvel-artisan': async () => { const p = projetCourant(), nom = prompt('Nom de l\'artisan ou de l\'entreprise'); if (!nom || !nom.trim()) return; const a = { id: uid(), nom: nom.trim() }; p.artisans.push(a); await sauverProjet(p); location.hash = '#/p/' + p.id + '/artisan/' + a.id; },
    'suppr-artisan': async el => {
      const p = projetCourant();
      if (p.devis.some(x => x.artisanId === el.dataset.id) || p.documents.some(x => x.artisanId === el.dataset.id)) { toast('Cette fiche a des devis ou factures : supprimez-les d\'abord.', 4000); return; }
      if (!confirm('Supprimer cette fiche ?')) return;
      p.artisans = p.artisans.filter(x => x.id !== el.dataset.id); await sauverProjet(p); location.hash = '#/p/' + p.id + '/artisans';
    },
    'ajout-regle': async () => { const p = projetCourant(); p.regles.unshift({ mot: '', categorie: '', enveloppe: 'travaux', posteNom: '', lotNom: '' }); await sauverProjet(p); rendre(); },
    'suppr-regle': async el => { const p = projetCourant(); p.regles.splice(Number(el.dataset.i), 1); await sauverProjet(p); rendre(); },
    'menu-projet': () => {
      const p = projetCourant();
      feuille('<h2>' + esc(p.nom) + '</h2><button class="gros-bouton" data-action="renommer-projet">✏️ Renommer le projet</button>' +
        '<button class="gros-bouton" data-action="aller-fermer" data-cible="#/p/' + p.id + '/regles">🏷️ Règles de classement</button>' +
        '<button class="gros-bouton" data-action="export-excel">📊 Exporter en Excel</button>' +
        '<button class="gros-bouton" data-action="sauvegarder">💾 Sauvegarder (tous les projets)</button>' +
        '<button class="gros-bouton rouge" data-action="suppr-projet">🗑 Supprimer le projet</button><button class="secondaire" data-action="fermer-feuille">Fermer</button>');
    },
    'aller-fermer': el => { fermerFeuille(); location.hash = el.dataset.cible; },
    'renommer-projet': async () => { const p = projetCourant(), nom = prompt('Nom du projet', p.nom); if (!nom || !nom.trim()) return; p.nom = nom.trim(); await sauverProjet(p); fermerFeuille(); rendre(); },
    'export-excel': async () => { fermerFeuille(); await exporterExcel(projetCourant()); },
    'suppr-projet': async () => {
      const p = projetCourant();
      if (prompt('Pour supprimer définitivement « ' + p.nom + ' » et toutes ses données, tapez SUPPRIMER. Pensez à sauvegarder avant.') !== 'SUPPRIMER') return;
      for (const d of p.documents) if (d.fichierId) await magasin.supprimerFichier(d.fichierId);
      delete S.projets[p.id]; S.etat.ordre = S.etat.ordre.filter(x => x !== p.id);
      await magasin.supprimer('projet:' + p.id); await sauverEtat(); fermerFeuille(); location.hash = '#/accueil';
    },
    'sauvegarder': () => { fermerFeuille(); sauvegarder(); },
    'importer': () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => i.files[0] && importer(i.files[0]); i.click(); },
    'profil-couleur': async el => { profil().couleur = el.dataset.couleur; await sauverEtat(); rendre(); },
    'nouveau-profil': async () => { const nom = prompt('Prénom du nouveau profil'); if (!nom || !nom.trim()) return; const pr = { id: uid(), nom: nom.trim(), couleur: COULEURS[S.etat.profils.length % COULEURS.length] }; S.etat.profils.push(pr); S.etat.profilId = pr.id; await sauverEtat(); rendre(); },
    'stockage': () => {}
  };

  /* ---------------- Changements (champs) ---------------- */
  async function changerPosteSelect(p, cible, champ, valeur, env, axe) {
    if (valeur === '__nouveau') { const x = demanderNomPoste(p, env, axe, null); valeur = x ? x.id : ''; await sauverProjet(p); }
    cible[champ] = valeur;
  }
  const changements = {
    'fichier': el => { const f = el.files[0]; fermerFeuille(); if (f) traiterFichier(f, el.dataset.nature); },
    'r-type': el => { const b = S.brouillon; b.doc.type = el.value; if (el.value === 'devis' && !b.devis) b.devis = { statut: 'recu', env: 'travaux', posteId: '', lotId: '', objet: '' }; if (el.value !== 'devis' && !b.doc.lignes.length) actions['ajout-ligne'](); calculerDoublon(); rendre(); },
    'r-champ': el => { const d = S.brouillon.doc; d[el.dataset.champ] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value; if (['date', 'total', 'numero'].indexOf(el.dataset.champ) !== -1) calculerDoublon(); rendre(); },
    'r-compter': el => { const d = S.brouillon.doc; d.compter = el.checked; S.brouillon.choixCompter = true; if (el.checked) d.motif = ''; rendre(); },
    'r-artisan': async el => {
      const b = S.brouillon, p = S.projets[b.projetId];
      if (el.value === '__nouveau') { const nom = prompt('Nom de l\'artisan', b.doc.fournisseur); if (!nom) { rendre(); return; } const a = { id: uid(), nom: nom.trim() }; p.artisans.push(a); await sauverProjet(p); b.doc.artisanId = a.id; }
      else b.doc.artisanId = el.value;
      b.doc.devisId = ''; rendre();
    },
    'r-devis': el => { S.brouillon.devis[el.dataset.champ] = el.value; },
    'rd-env': el => { const dv = S.brouillon.devis; dv.env = el.value; dv.posteId = ''; dv.lotId = ''; rendre(); },
    'rd-poste': async el => { const dv = S.brouillon.devis; await changerPosteSelect(S.projets[S.brouillon.projetId], dv, 'posteId', el.value, dv.env, 'piece'); rendre(); },
    'rd-lot': async el => { const dv = S.brouillon.devis; await changerPosteSelect(S.projets[S.brouillon.projetId], dv, 'lotId', el.value, 'travaux', 'lot'); rendre(); },
    'r-ligne': el => { const l = S.brouillon.doc.lignes.find(x => x.id === el.dataset.id); l[el.dataset.champ] = el.dataset.champ === 'montant' ? Number(el.value) : el.value; if (el.dataset.champ === 'libelle' && D.ligneAClasser(S.projets[S.brouillon.projetId], l)) { const pr = proposerClassement(S.projets[S.brouillon.projetId], l.libelle); if (pr.origine !== 'aucune') Object.assign(l, pr.c, { origine: pr.origine }); } rendre(); },
    'rl-env': el => { const l = S.brouillon.doc.lignes.find(x => x.id === el.dataset.id); l.env = el.value; l.posteId = ''; l.lotId = ''; l.origine = 'manuel'; rendre(); },
    'rl-poste': async el => { const l = S.brouillon.doc.lignes.find(x => x.id === el.dataset.id); await changerPosteSelect(S.projets[S.brouillon.projetId], l, 'posteId', el.value, l.env, 'piece'); l.origine = 'manuel'; rendre(); },
    'rl-lot': async el => { const l = S.brouillon.doc.lignes.find(x => x.id === el.dataset.id); await changerPosteSelect(S.projets[S.brouillon.projetId], l, 'lotId', el.value, 'travaux', 'lot'); l.origine = 'manuel'; rendre(); },
    'rl-cat': el => { const l = S.brouillon.doc.lignes.find(x => x.id === el.dataset.id); l.categorie = el.value; },
    'r-toujours': el => { const l = S.brouillon.doc.lignes.find(x => x.id === el.dataset.id); l.toujours = el.checked; },
    'ac-env': async el => { const p = projetCourant(), t = trouverLigne(p, el.dataset.id); t.l.env = el.value; t.l.posteId = ''; t.l.lotId = ''; await sauverProjet(p); rendre(); },
    'ac-poste': async el => { const p = projetCourant(), t = trouverLigne(p, el.dataset.id); await changerPosteSelect(p, t.l, 'posteId', el.value, t.l.env, 'piece'); memoriser(p, t.l, t.l.toujours); await sauverProjet(p); rendre(); if (!D.ligneAClasser(p, t.l)) toast('Classé.'); },
    'ac-lot': async el => { const p = projetCourant(), t = trouverLigne(p, el.dataset.id); await changerPosteSelect(p, t.l, 'lotId', el.value, 'travaux', 'lot'); memoriser(p, t.l, t.l.toujours); await sauverProjet(p); rendre(); if (!D.ligneAClasser(p, t.l)) toast('Classé.'); },
    'ac-cat': async el => { const p = projetCourant(), t = trouverLigne(p, el.dataset.id); t.l.categorie = el.value; await sauverProjet(p); },
    'ac-toujours': async el => { const p = projetCourant(), t = trouverLigne(p, el.dataset.id); t.l.toujours = el.checked; memoriser(p, t.l, el.checked); await sauverProjet(p); },
    'ac-sel': el => { S.selection = S.selection || {}; S.selection[el.value] = el.checked; rendre(); },
    'gr-env': el => { S.groupe = Object.assign(S.groupe || { id: 'groupe' }, { env: el.value, posteId: '', lotId: '' }); rendre(); },
    'gr-poste': async el => { S.groupe = S.groupe || { id: 'groupe' }; await changerPosteSelect(projetCourant(), S.groupe, 'posteId', el.value, S.groupe.env, 'piece'); rendre(); },
    'gr-lot': async el => { S.groupe = S.groupe || { id: 'groupe' }; await changerPosteSelect(projetCourant(), S.groupe, 'lotId', el.value, 'travaux', 'lot'); rendre(); },
    'gr-cat': el => { S.groupe = S.groupe || { id: 'groupe' }; S.groupe.categorie = el.value; },
    'prevu': async el => { const p = projetCourant(); p.postes.find(x => x.id === el.dataset.id).prevu = Number(el.value) || 0; await sauverProjet(p); rendre(); },
    'statut': async el => { const p = projetCourant(); p.postes.find(x => x.id === el.dataset.id).statut = el.value; await sauverProjet(p); },
    'statut-devis': async el => { const p = projetCourant(); p.devis.find(x => x.id === el.dataset.id).statut = el.value; await sauverProjet(p); rendre(); },
    'artisan': async el => { const p = projetCourant(), a = p.artisans.find(x => x.id === S.route.arg); a[el.dataset.champ] = el.value; await sauverProjet(p); },
    'regle': async el => { const p = projetCourant(); p.regles[Number(el.dataset.i)][el.dataset.champ] = el.value; await sauverProjet(p); if (el.dataset.champ === 'enveloppe') rendre(); },
    'profil-nom': async el => { profil().nom = el.value.trim() || profil().nom; await sauverEtat(); },
    'profil-actif': async el => { S.etat.profilId = el.value; await sauverEtat(); rendre(); },
    'validation': async el => { S.etat.reglages.validation = el.value; await sauverEtat(); toast(el.value === 'automatique' ? 'Validation automatique activée.' : 'Validation complète activée.'); },
    'rappel': async el => { S.etat.reglages.rappelJours = Math.max(1, Number(el.value) || 30); await sauverEtat(); }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const f = actions[el.dataset.action];
    if (f) { e.preventDefault(); f(el, e); }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && changements[el.dataset.change]) changements[el.dataset.change](el, e);
  });

  /* Infobulles (survol ou toucher) */
  (function () {
    const bulle = $('#infobulle');
    const montrer = (c, x, y) => { bulle.textContent = c.getAttribute('data-tip'); bulle.style.display = 'block'; const w = bulle.offsetWidth, h = bulle.offsetHeight; bulle.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px'; bulle.style.top = Math.max(8, y - h - 12) + 'px'; };
    document.addEventListener('mousemove', e => { const c = e.target.closest('[data-tip]'); if (c) montrer(c, e.clientX, e.clientY); else bulle.style.display = 'none'; });
    document.addEventListener('click', e => { const c = e.target.closest('[data-tip]'); if (c) { const r = c.getBoundingClientRect(); montrer(c, r.left + r.width / 2, r.top); } else bulle.style.display = 'none'; });
    addEventListener('scroll', () => { bulle.style.display = 'none'; }, { passive: true });
  })();

  window.addEventListener('hashchange', rendre);
  charger().then(rendre).catch(e => { $('#app').innerHTML = '<main class="page"><div class="alerte erreur">Impossible d\'ouvrir le stockage du téléphone : ' + esc(e.message) + '</div></main>'; });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
  window.__app = { S, actions, changements, D, ouvrirRevue }; // pour les tests
})();
