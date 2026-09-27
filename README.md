# Learn My Text

Une petite application web pour apprendre un texte de théâtre.

## Utilisation

Ouvre `index.html` dans un navigateur, colle ton texte, puis clique sur **Commencer à apprendre**.

- **Apprentissage** : le texte reste visible pour le lire et le mémoriser.
- **Récitation** : le texte à apprendre reste masqué. Écris toute la récitation librement dans une zone de texte. Les mots incorrects sont soulignés dans cette zone et le mot attendu s’affiche juste en dessous. Tu peux corriger n’importe quel passage à tout moment.
- Le texte saisi reste enregistré dans le stockage local du navigateur. Aucune donnée n’est envoyée à un serveur par l’application.

La casse est tolérée. Toute ponctuation est ignorée pendant la récitation : `n'est`, `nest` et `n’est` sont équivalents. Les accents restent vérifiés.

## Développement

Application statique sans étape de compilation ni dépendance JavaScript. Pour servir les fichiers localement, utilise par exemple `python -m http.server 8000`, puis ouvre `http://localhost:8000`.
