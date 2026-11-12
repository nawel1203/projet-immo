# Suivi Projet Immo — V1

Application mobile gratuite pour suivre le coût d'un projet immobilier : factures, devis, budget (acquisition, travaux, mobilier), artisans et avancement.
Les données restent sur le téléphone (stockage interne). Aucune donnée n'est envoyée sur internet.

## Mise en ligne gratuite avec GitHub Pages (une seule fois, environ 15 minutes)

1. Créez un compte gratuit sur https://github.com (bouton « Sign up »).
2. En haut à droite, « + » → **New repository**.
   - Repository name : `projet-immo`
   - Cochez **Public** (obligatoire pour l'hébergement gratuit). Seul le code de l'application est public : vos factures et vos chiffres restent sur votre téléphone.
   - Cliquez sur **Create repository**.
3. Sur la page qui s'affiche, cliquez sur le lien **uploading an existing file**.
4. Décompressez le fichier `suivi-projet-immo-v1.zip` sur votre ordinateur, ouvrez le dossier obtenu, sélectionnez **tout son contenu** (index.html, sw.js, manifest.webmanifest et les dossiers css, js, icons) et glissez-le dans la page GitHub.
5. Cliquez sur **Commit changes** en bas de la page.
6. Allez dans **Settings** (onglet en haut) → **Pages** (menu de gauche).
   - Source : **Deploy from a branch**
   - Branch : **main**, dossier **/ (root)** → **Save**.
7. Attendez 1 à 2 minutes, puis rechargez la page : l'adresse de votre application s'affiche, du type
   `https://VOTRE-PSEUDO.github.io/projet-immo/`

## Installer l'application sur le téléphone (Android)

1. Ouvrez l'adresse ci-dessus dans **Chrome**.
2. Menu **⋮** → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. Une icône verte « Projet Immo » apparaît : l'application s'ouvre comme une appli normale, et fonctionne aussi hors connexion.

La première lecture d'un PDF ou d'une photo demande internet : l'application télécharge alors son module de lecture (une dizaine de Mo pour les photos), puis le garde.

## Mettre à jour l'application plus tard

Dans votre dépôt GitHub : **Add file → Upload files**, glissez les nouveaux fichiers (ils remplacent les anciens), puis **Commit changes**.
L'application se met à jour toute seule à la prochaine ouverture. Vos données ne sont pas touchées.

## Sauvegarde

Mode interne = données dans le téléphone. Utilisez régulièrement **💾 Sauvegarder** (accueil ou Réglages) et rangez le fichier obtenu en lieu sûr (e-mail, Drive, ordinateur). Un rappel s'affiche après 30 jours sans sauvegarde (délai réglable).
Pour tout récupérer sur un autre téléphone : installez l'application, puis **Importer un projet** et choisissez ce fichier.
