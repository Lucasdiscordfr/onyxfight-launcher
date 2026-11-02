# OnyxFight Launcher

Launcher officiel du serveur **OnyxFight** (Minecraft 1.7.10 moddé, PvP Faction).

- Connexion avec un compte Microsoft (Minecraft Java Edition obligatoire).
- Installe tout seul Java 8, Minecraft 1.7.10, Forge et le mod OnyxFight, puis les garde à jour.
- Se met à jour tout seul.
- Bouton **Jouer** qui connecte directement au serveur.

## Télécharger
Dernière version : onglet **Releases** de ce dépôt (`OnyxFight-Launcher.exe` : double-clic, le launcher s’ouvre directement).

## Pour l'équipe
- `distribution/manifest.json` : adresse du serveur et fichiers à installer (mis à jour automatiquement à chaque
  nouvelle version du mod).
- `distribution/actualites.json` : actualités affichées dans le launcher (date, titre, texte, lien facultatif).
- Nouvelle version du launcher : augmenter `version` dans `package.json` et pousser ; GitHub Actions construit
  l'installateur Windows et le publie, les launchers déjà installés se mettent à jour seuls.
- Essai en local : `npm install` puis `npm start`.
