# TMDB to Plex - Deployment Guide

## Setup completo con Docker

### 1. Configurazione GitHub Secrets (OBBLIGATORIO)

Prima di fare il push, configura i secrets su GitHub:

1. Vai su `https://github.com/merlinoalbus/tmdbtoplex/settings/secrets/actions`
2. Aggiungi i seguenti secrets (clic su "New repository secret"):
   - `VITE_TMDB_BEARER_TOKEN` = `eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4NWU0MzY5NzJhZDFmMGZlYmRkMzFmYTBlZjE1NzkzZCIsIm5iZiI6MTYxMzAwNDU4Ni41ODYsInN1YiI6IjYwMjQ3ZjJhYzVhZGE1MDA0MDdlOTNhNCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.iyF0TcoBTiU20o-us5Z-0pI0tlgtpX4G_wvc03OYCTw`
   - `VITE_GOOGLE_API_KEY` = `AIzaSyAg1x6hnUnyv03j6CghImqvRiWcub8R7mQ`
   - `VITE_OMDB_API_KEY` = `2d49fa71`

### 2. GitHub Actions (automatico)
Dopo il push su `main`, GitHub Actions compila automaticamente le immagini Docker con le variabili d'ambiente embedded e le pubblica su GitHub Container Registry (ghcr.io).

### 3. Deploy con Portainer Stack (AUTO-UPDATE)

In Portainer, crea un nuovo Stack usando `portainer-stack.yml`:

1. Vai su **Stacks** → **Add stack**
2. Nome: `tmdbtoplex`
3. Incolla il contenuto di `portainer-stack.yml`
4. **Importante**: Abilita **"Re-pull image and redeploy"** nelle impostazioni dello stack
5. Deploy

### 4. Configurazione Auto-Update Portainer

Per far sì che Portainer aggiorni automaticamente i container ad ogni push:

**Opzione A - Webhook Portainer (consigliato):**
1. In Portainer, vai su **Stacks** → seleziona `tmdbtoplex` → **Webhooks**
2. Copia l'URL del webhook generato
3. Su GitHub vai su **Settings** → **Webhooks** → **Add webhook**
4. Incolla l'URL del webhook Portainer
5. Content type: `application/json`
6. Seleziona "Just the push event"
7. Salva

**Opzione B - Watchtower (INCLUSO in portainer-stack.yml):**
Watchtower è già configurato in `portainer-stack.yml` e monitora automaticamente gli aggiornamenti ogni 5 minuti:
- Controlla nuove versioni delle immagini su GHCR
- Scarica automaticamente gli aggiornamenti
- Riavvia i container con le nuove immagini
- Rimuove le vecchie immagini (`WATCHTOWER_CLEANUP=true`)

### 5. Accesso ai servizi

- **Frontend**: http://localhost:13500
- **Backend**: http://localhost:13501

Le variabili d'ambiente sono già configurate:
- Frontend: API keys embedded durante il build Docker
- Backend: URL `http://localhost:13501` configurato in fase di build
- Network interno: I container comunicano via rete Docker bridge

### 6. Build locale (opzionale)

Se vuoi buildare localmente invece che con GitHub Actions:

```bash
# Backend
cd imdb-scraper-backend
docker build -t ghcr.io/merlinoalbus/tmdbtoplex-backend:latest .

# Frontend
cd frontend
docker build \
  --build-arg VITE_TMDB_BEARER_TOKEN="your_token" \
  --build-arg VITE_GOOGLE_API_KEY="your_key" \
  --build-arg VITE_OMDB_API_KEY="your_key" \
  --build-arg VITE_IMDB_SCRAPER_BASE_URL="http://localhost:13501" \
  -t ghcr.io/merlinoalbus/tmdbtoplex-frontend:latest .
```

### 7. Note importanti

- Le immagini Docker sono pubblicate automaticamente ad ogni push su `main`
- Le variabili d'ambiente del frontend vengono **embedded nel bundle JavaScript** durante il build
- Il backend espone l'API REST sulla porta interna 4000 (mappata su 13501 esterna)
- Le porte 13500 (FE) e 13501 (BE) devono essere disponibili sul server
- **Webhook Portainer**: Configura webhook per auto-deploy ad ogni push GitHub
- **pull_policy: always**: Portainer scarica sempre l'ultima immagine disponibile
