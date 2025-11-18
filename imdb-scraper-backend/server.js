import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

/**
 * GET /api/tmdb-proxy/*
 * Proxy per TMDB API per evitare CORS
 */
app.get('/api/tmdb-proxy/*', async (req, res) => {
  const path = req.params[0];
  const queryString = new URLSearchParams(req.query).toString();
  const url = `https://api.themoviedb.org/3/${path}${queryString ? '?' + queryString : ''}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': req.headers.authorization || '',
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (err) {
    console.error('Errore proxy TMDB:', err.message);
    res.status(err.response?.status || 500).json({ 
      error: 'Errore proxy TMDB', 
      details: err.message 
    });
  }
});

/**
 * GET /api/imdb/:imdbId
 * Esempio: /api/imdb/tt0344854
 */
app.get('/api/imdb/:imdbId', async (req, res) => {
  const { imdbId } = req.params;

  if (!imdbId) {
    return res.status(400).json({ error: 'imdbId mancante' });
  }

  const url = `https://www.imdb.com/title/${imdbId}/`;

  try {
    const response = await axios.get(url, {
      headers: {
        // header "umani"
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      // se IMDb reindirizza a /it/ ecc, lasciamo fare
      maxRedirects: 5,
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // 1) Chips (quelli che hai incollato tu)
    const chipTexts = [];
    $('.ipc-chip__text').each((_, el) => {
      const txt = $(el).text().trim();
      if (txt) chipTexts.push(txt);
    });

    // 2) Registi e Autori (parsati alla "meglio" dal blocco credits)
    // La struttura può cambiare, quindi questa parte potresti doverla
    // rifinire guardando l'HTML reale con devtools.
    const directors = new Set();
    const writers = new Set();

    // Esempio: cerchiamo i blocchi principali dei credits
    $('[data-testid="title-pc-principal-credit"]').each((_, el) => {
      const role = $(el).find('span.ipc-metadata-list-item__label').text().toLowerCase();
      const names = $(el)
        .find('a')
        .map((__, a) => $(a).text().trim())
        .get()
        .filter(Boolean);

      if (role.includes('regia') || role.includes('director')) {
        names.forEach((n) => directors.add(n));
      } else if (role.includes('sceneggiatura') || role.includes('writer')) {
        names.forEach((n) => writers.add(n));
      }
    });

    // Fallback: se non trova nulla, pesca da "Cast & crew" base (molto grezzo)
    if (directors.size === 0) {
      $('[data-testid="title-cast-item__actor"], a[href*="/name/"]').each((_, el) => {
        const txt = $(el).text().trim();
        // qui potresti mettere una euristica più furba
      });
    }

    res.json({
      imdbId,
      chips: chipTexts,                  // <-- questi sono i famosi chip
      directors: Array.from(directors),  // registi
      writers: Array.from(writers),      // autori/sceneggiatori
    });
  } catch (err) {
    console.error('Errore scraping IMDb:', err.message);
    res.status(500).json({ error: 'Errore scraping IMDb', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`IMDb scraper backend in ascolto su http://localhost:${PORT}`);
});
