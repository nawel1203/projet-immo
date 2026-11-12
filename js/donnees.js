/* =====================================================================
 * Données : stockage interne (IndexedDB), modèles de projet, calculs.
 * Le stockage est isolé ici : la V1.1 (dossier partagé) ajoutera un second
 * « magasin » avec les mêmes fonctions, sans toucher aux écrans.
 * ===================================================================== */
(function (racine) {
  'use strict';
  const arrondi = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------- Magasin interne (IndexedDB) ---------------- */
  const MagasinInterne = {
    _db: null,
    ouvrir() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((ok, ko) => {
        const r = indexedDB.open('suivi-projet-immo', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('fichiers')) db.createObjectStore('fichiers');
        };
        r.onsuccess = () => { this._db = r.result; ok(this._db); };
        r.onerror = () => ko(r.error);
      });
    },
    _tx(store, mode, fn) {
      return this.ouvrir().then(db => new Promise((ok, ko) => {
        const tx = db.transaction(store, mode);
        const res = fn(tx.objectStore(store));
        tx.oncomplete = () => ok(res && res.result !== undefined ? res.result : undefined);
        tx.onerror = () => ko(tx.error);
      }));
    },
    lire(cle) { return this._tx('kv', 'readonly', s => s.get(cle)); },
    ecrire(cle, val) { return this._tx('kv', 'readwrite', s => s.put(val, cle)); },
    supprimer(cle) { return this._tx('kv', 'readwrite', s => s.delete(cle)); },
    cles() { return this._tx('kv', 'readonly', s => s.getAllKeys()); },
    lireFichier(id) { return this._tx('fichiers', 'readonly', s => s.get(id)); },
    ecrireFichier(id, f) { return this._tx('fichiers', 'readwrite', s => s.put(f, id)); },
    supprimerFichier(id) { return this._tx('fichiers', 'readwrite', s => s.delete(id)); },
    clesFichiers() { return this._tx('fichiers', 'readonly', s => s.getAllKeys()); }
  };

  /* ---------------- Modèles proposés à la création ---------------- */
  const ENVELOPPES = [
    { cle: 'acquisition', nom: 'Acquisition' },
    { cle: 'travaux', nom: 'Travaux' },
    { cle: 'mobilier', nom: 'Mobilier' }
  ];

  const MODELE = {
    acquisition: [
      ['Prix d\'achat'],
      ['Frais de notaire', ['Droits de mutation', 'Émoluments du notaire', 'Débours et formalités']],
      ['Frais d\'agence'],
      ['Frais bancaires', ['Frais de dossier', 'Garantie (caution ou hypothèque)', 'Courtage']],
      ['Autres frais', ['Diagnostics', 'Déménagement']]
    ],
    travauxPieces: ['Cuisine', 'Salle de bain', 'Salon', 'Chambre', 'Entrée / couloir', 'WC', 'Tout le logement'],
    travauxLots: ['Démolition', 'Plomberie', 'Électricité', 'Plâtrerie / isolation', 'Menuiserie', 'Sols', 'Peinture', 'Chauffage', 'Outillage et consommables', 'Divers'],
    mobilier: [
      ['Salon', ['Canapé', 'Table basse', 'Meuble TV', 'Luminaires', 'Décoration']],
      ['Chambre', ['Lit et matelas', 'Rangements']],
      ['Cuisine', ['Électroménager', 'Petit équipement']],
      ['Salle de bain', ['Accessoires']],
      ['Laverie', ['Électroménager']],
      ['Divers']
    ]
  };

  // Mot-clé (début de mot) → catégorie, enveloppe, lot (travaux), pièce/poste. Modifiable dans Réglages.
  const REGLES = [
    ['easy3', 'Meuble de salle de bain', 'travaux', 'Plomberie', 'Salle de bain'],
    ['vasque', 'Sanitaire', 'travaux', 'Plomberie', 'Salle de bain'],
    ['mitigeur', 'Robinetterie', 'travaux', 'Plomberie', ''],
    ['robinet', 'Robinetterie', 'travaux', 'Plomberie', ''],
    ['chasse', 'Sanitaire', 'travaux', 'Plomberie', ''],
    ['bonde', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['siphon', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['coude', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['reduction', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['manchette', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['tampon', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['tube', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['collier', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['colle', 'Plomberie', 'travaux', 'Plomberie', ''],
    ['peint', 'Peinture', 'travaux', 'Peinture', ''],
    ['dexter', 'Peinture', 'travaux', 'Peinture', ''],
    ['rouleau', 'Peinture', 'travaux', 'Peinture', ''],
    ['enduit', 'Peinture', 'travaux', 'Peinture', ''],
    ['led', 'Éclairage', 'travaux', 'Électricité', ''],
    ['ampoule', 'Éclairage', 'travaux', 'Électricité', ''],
    ['susp', 'Éclairage', 'travaux', 'Électricité', ''],
    ['cable', 'Électricité', 'travaux', 'Électricité', ''],
    ['prise', 'Électricité', 'travaux', 'Électricité', ''],
    ['interrupteur', 'Électricité', 'travaux', 'Électricité', ''],
    ['plq', 'Plâtrerie', 'travaux', 'Plâtrerie / isolation', ''],
    ['platre', 'Plâtrerie', 'travaux', 'Plâtrerie / isolation', ''],
    ['ba13', 'Plâtrerie', 'travaux', 'Plâtrerie / isolation', ''],
    ['montant', 'Plâtrerie', 'travaux', 'Plâtrerie / isolation', ''],
    ['rail', 'Plâtrerie', 'travaux', 'Plâtrerie / isolation', ''],
    ['isolant', 'Isolation', 'travaux', 'Plâtrerie / isolation', ''],
    ['cloison', 'Menuiserie', 'travaux', 'Menuiserie', ''],
    ['porte', 'Menuiserie', 'travaux', 'Menuiserie', ''],
    ['plinthe', 'Finitions', 'travaux', 'Menuiserie', ''],
    ['plan trav', 'Plan de travail', 'travaux', 'Menuiserie', 'Cuisine'],
    ['dalle', 'Revêtement de sol', 'travaux', 'Sols', ''],
    ['parquet', 'Revêtement de sol', 'travaux', 'Sols', ''],
    ['carrelage', 'Revêtement de sol', 'travaux', 'Sols', ''],
    ['radiateur', 'Chauffage', 'travaux', 'Chauffage', ''],
    ['kaltar', 'Chauffage', 'travaux', 'Chauffage', ''],
    ['marchepied', 'Outillage', 'travaux', 'Outillage et consommables', ''],
    ['ventouse', 'Outillage', 'travaux', 'Outillage et consommables', ''],
    ['feuill', 'Outillage', 'travaux', 'Outillage et consommables', ''],
    ['javel', 'Entretien', 'travaux', 'Outillage et consommables', ''],
    ['deboucheur', 'Entretien', 'travaux', 'Outillage et consommables', ''],
    ['sac cabas', 'Divers', 'travaux', 'Divers', ''],
    ['canape', 'Mobilier', 'mobilier', '', 'Salon'],
    ['fauteuil', 'Mobilier', 'mobilier', '', 'Salon'],
    ['table basse', 'Mobilier', 'mobilier', '', 'Salon'],
    ['chaise', 'Mobilier', 'mobilier', '', ''],
    ['matelas', 'Literie', 'mobilier', '', 'Chambre'],
    ['sommier', 'Literie', 'mobilier', '', 'Chambre'],
    ['commode', 'Mobilier', 'mobilier', '', 'Chambre'],
    ['armoire', 'Mobilier', 'mobilier', '', 'Chambre'],
    ['etagere', 'Mobilier', 'mobilier', '', ''],
    ['tapis', 'Décoration', 'mobilier', '', ''],
    ['rideau', 'Décoration', 'mobilier', '', ''],
    ['refrigerateur', 'Électroménager', 'mobilier', '', 'Cuisine'],
    ['lave linge', 'Électroménager', 'mobilier', '', 'Laverie'],
    ['lave vaisselle', 'Électroménager', 'mobilier', '', 'Cuisine'],
    ['micro onde', 'Électroménager', 'mobilier', '', 'Cuisine'],
    ['notaire', 'Frais de notaire', 'acquisition', '', 'Frais de notaire'],
    ['agence', 'Frais d\'agence', 'acquisition', '', 'Frais d\'agence'],
    ['diagnostic', 'Diagnostics', 'acquisition', '', 'Diagnostics']
  ].map(r => ({ mot: r[0], categorie: r[1], enveloppe: r[2], lotNom: r[3], posteNom: r[4] }));

  function nouveauProjet(nom, adresse, enveloppes, auteurId) {
    const postes = [];
    const ajouter = (env, nomP, parentId, axe) => { const p = { id: uid(), env, nom: nomP, parentId: parentId || null, axe: axe || null, prevu: 0, statut: 'a-faire' }; postes.push(p); return p; };
    if (enveloppes.indexOf('acquisition') !== -1) MODELE.acquisition.forEach(([n, sous]) => { const p = ajouter('acquisition', n); (sous || []).forEach(s => ajouter('acquisition', s, p.id)); });
    if (enveloppes.indexOf('travaux') !== -1) {
      MODELE.travauxPieces.forEach(n => ajouter('travaux', n, null, 'piece'));
      MODELE.travauxLots.forEach(n => ajouter('travaux', n, null, 'lot'));
    }
    if (enveloppes.indexOf('mobilier') !== -1) MODELE.mobilier.forEach(([n, sous]) => { const p = ajouter('mobilier', n); (sous || []).forEach(s => ajouter('mobilier', s, p.id)); });
    return {
      id: uid(), nom, adresse: adresse || '', creeLe: new Date().toISOString(), creePar: auteurId,
      enveloppes, axeTravaux: 'piece', postes, regles: REGLES.map(r => Object.assign({}, r)), memoire: [],
      artisans: [], devis: [], documents: [], corbeille: []
    };
  }

  /* ---------------- Calculs ---------------- */
  function descendants(projet, id) {
    const res = [id];
    projet.postes.forEach(p => { if (p.parentId === id) res.push(...descendants(projet, p.id)); });
    return res;
  }

  /** Une ligne est « à classer » s'il lui manque l'enveloppe ou le poste de l'axe suivi. */
  function ligneAClasser(projet, l) {
    if (!l.env) return true;
    if (l.env === 'travaux') return projet.axeTravaux === 'lot' ? !l.lotId : !l.posteId;
    return !l.posteId;
  }

  function lignesComptees(projet) {
    const out = [];
    projet.documents.forEach(d => { if (d.compter !== false && d.type !== 'devis') d.lignes.forEach(l => out.push(Object.assign({ doc: d }, l))); });
    return out;
  }

  function engageRestant(projet, dv) {
    if (dv.statut !== 'signe') return 0;
    const facture = projet.documents.filter(d => d.devisId === dv.id && d.compter !== false).reduce((s, d) => s + (Number(d.total) || 0), 0);
    return Math.max(0, arrondi(dv.montantTTC - facture));
  }

  /** Chiffres du projet : par enveloppe, par poste, par catégorie, par mois, par artisan. */
  function calculer(projet) {
    const lignes = lignesComptees(projet);
    const depPoste = {}, depLot = {}, depEnv = {}, parCat = {}, parMois = {};
    let total = 0, aClasserN = 0, aClasserM = 0;
    lignes.forEach(l => {
      const m = Number(l.montant) || 0;
      total += m;
      depEnv[l.env || ''] = (depEnv[l.env || ''] || 0) + m;
      if (l.posteId) depPoste[l.posteId] = (depPoste[l.posteId] || 0) + m;
      if (l.lotId) depLot[l.lotId] = (depLot[l.lotId] || 0) + m;
      const cat = (l.categorie || 'Non renseigné').split('/')[0].trim();
      parCat[cat] = (parCat[cat] || 0) + m;
      const mois = (l.doc.date || '').slice(0, 7) || 'sans date';
      parMois[mois] = (parMois[mois] || 0) + m;
      if (ligneAClasser(projet, l)) { aClasserN++; aClasserM += m; }
    });
    const engPoste = {}, engEnv = {};
    projet.devis.forEach(dv => {
      const e = engageRestant(projet, dv);
      if (!e) return;
      engEnv[dv.env || ''] = (engEnv[dv.env || ''] || 0) + e;
      const cible = dv.env === 'travaux' && projet.axeTravaux === 'lot' ? dv.lotId : dv.posteId;
      if (cible) engPoste[cible] = (engPoste[cible] || 0) + e;
    });
    const somme = (ids, table) => ids.reduce((s, id) => s + (table[id] || 0), 0);
    const postes = projet.postes.map(p => {
      const ids = descendants(projet, p.id);
      const table = p.axe === 'lot' ? depLot : depPoste;
      const sous = projet.postes.filter(x => x.parentId === p.id);
      const prevu = sous.length ? sous.reduce((s, x) => s + (Number(x.prevu) || 0), 0) + (Number(p.prevu) || 0) : (Number(p.prevu) || 0);
      return { id: p.id, env: p.env, nom: p.nom, parentId: p.parentId, axe: p.axe, statut: p.statut, prevu: arrondi(prevu), depense: arrondi(somme(ids, table)), engage: arrondi(somme(ids, engPoste)) };
    });
    const enveloppes = ENVELOPPES.filter(e => projet.enveloppes.indexOf(e.cle) !== -1).map(e => {
      const racines = postes.filter(p => p.env === e.cle && !p.parentId && (e.cle !== 'travaux' || p.axe === projet.axeTravaux));
      return { cle: e.cle, nom: e.nom, prevu: arrondi(racines.reduce((s, p) => s + p.prevu, 0)), depense: arrondi(depEnv[e.cle] || 0), engage: arrondi(engEnv[e.cle] || 0) };
    });
    const sansEnveloppe = arrondi(depEnv[''] || 0);
    const docsComptes = projet.documents.filter(d => d.compter !== false && d.type !== 'devis');
    const totalDocs = arrondi(docsComptes.reduce((s, d) => s + (Number(d.total) || 0), 0));
    const artisans = projet.artisans.map(a => {
      const devis = projet.devis.filter(dv => dv.artisanId === a.id);
      const paye = projet.documents.filter(d => d.artisanId === a.id && d.compter !== false && d.type !== 'devis').reduce((s, d) => s + (Number(d.total) || 0), 0);
      const engage = devis.reduce((s, dv) => s + engageRestant(projet, dv), 0);
      const retenue = projet.documents.filter(d => d.artisanId === a.id && d.compter !== false).reduce((s, d) => s + (Number(d.retenue) || 0), 0);
      return { id: a.id, nom: a.nom, paye: arrondi(paye), engage: arrondi(engage), retenue: arrondi(retenue), nbDevis: devis.length };
    });
    const pieces = projet.postes.filter(p => p.env === 'travaux' && !p.parentId && p.axe === projet.axeTravaux);
    const avancement = { 'a-faire': 0, 'devis-demande': 0, 'devis-signe': 0, 'en-cours': 0, 'termine': 0 };
    pieces.forEach(p => { avancement[p.statut || 'a-faire'] = (avancement[p.statut || 'a-faire'] || 0) + 1; });
    const prevuTotal = arrondi(enveloppes.reduce((s, e) => s + e.prevu, 0));
    const engageTotal = arrondi(enveloppes.reduce((s, e) => s + e.engage, 0));
    return {
      total: arrondi(total), prevuTotal, engageTotal, disponible: arrondi(prevuTotal - total - engageTotal),
      enveloppes, sansEnveloppe, postes, aClasser: { nb: aClasserN, montant: arrondi(aClasserM) },
      controle: { ok: Math.abs(totalDocs - arrondi(total)) < 0.01, ecart: arrondi(totalDocs - total) },
      categories: Object.keys(parCat).map(k => ({ nom: k, montant: arrondi(parCat[k]) })).sort((a, b) => b.montant - a.montant),
      mois: Object.keys(parMois).sort().map(k => ({ cle: k, montant: arrondi(parMois[k]) })),
      artisans, avancement, nbPieces: pieces.length,
      retenue: arrondi(artisans.reduce((s, a) => s + a.retenue, 0))
    };
  }

  racine.Donnees = { MagasinInterne, ENVELOPPES, MODELE, REGLES, nouveauProjet, calculer, ligneAClasser, lignesComptees, engageRestant, descendants, uid, arrondi };
})(typeof window !== 'undefined' ? window : this);
