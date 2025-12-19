
import React, { useState, useEffect } from 'react';
import imdbGenreMap from './imdbGenreMap.json';

// ====== CONFIG ======
const TMDB_BEARER_TOKEN = import.meta.env.VITE_TMDB_BEARER_TOKEN || '';
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';

// backend scraper IMDb
const IMDB_SCRAPER_BASE_URL =
  import.meta.env.VITE_IMDB_SCRAPER_BASE_URL || 'https://tmdb2plex_be.nasmerlinoalbus.cloud';

// ====== UTILITY GENERICA: fetch con timeout + retry ======
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeoutAndRetry(
  url,
  options = {},
  {
    timeoutMs = 15000,
    retries = 2,
    backoffMs = 1500,
    logPrefix = '',
  } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (
          (response.status >= 500 || response.status === 429) &&
          attempt < retries
        ) {
          console.warn(
            `${logPrefix}HTTP ${response.status}, retry ${attempt + 1}/${retries}...`
          );
          await delay(backoffMs * (attempt + 1));
          continue;
        }
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      const isAbort =
        err.name === 'AbortError' || err.message?.includes('aborted');
      const isNetwork = err.message?.toLowerCase().includes('network');

      if ((isAbort || isNetwork) && attempt < retries) {
        console.warn(
          `${logPrefix}${err.message} - retry ${attempt + 1}/${retries}...`
        );
        await delay(backoffMs * (attempt + 1));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

// ====== TRADUZIONE TESTO ======
async function translateToItalian(text) {
  if (!text || !text.trim()) return text;
  
  try {
    // Usa l'API pubblica di Google Translate (non ufficiale ma funzionante)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=it&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Errore nella chiamata API traduzione');
    }
    
    const data = await response.json();
    
    // Il risultato è in data[0][x][0] per ogni segmento tradotto
    if (data && data[0]) {
      const translated = data[0].map(item => item[0]).join('');
      return translated;
    }
    
    return text;
  } catch (error) {
    console.error('Errore nella traduzione:', error);
    return text; // Ritorna il testo originale in caso di errore
  }
}

// ====== FUNZIONI DI SUPPORTO ======
// Mappatura universale generi -> generi interni caricata da JSON esterno
// La chiave è il testo del genere (da qualsiasi fonte), il valore è un array di generi interni.
const IMDB_GENRE_MAP = imdbGenreMap;

// normalizza una stringa per confronto (minuscolo, trim)
function normalizeKey(str) {
  if (!str) return '';
  return str
    .toString()
    .trim()
    .toLowerCase();
}

// Mappa UN genere attraverso l'imdbGenreMap (ritorna array)
// Se il genere mappa a [] (array vuoto), viene ignorato e non compare nella lista finale
function mapGenreToInternal(genreName) {
  if (!genreName || typeof genreName !== "string") return [];

  const normalizedMap = {};
  Object.entries(IMDB_GENRE_MAP || {}).forEach(([k, v]) => {
    normalizedMap[normalizeKey(k)] = v || [];
  });

  const key = genreName.trim();
  const normKey = normalizeKey(key);
  const mapped = normalizedMap[normKey];

  // Se il genere è nella mappa, usa il mapping (anche se è array vuoto per ignorare)
  if (mapped !== undefined) {
    return mapped;
  } else {
    // fallback: usa il genere originale se non mappato
    return [key];
  }
}

// Mappa un array di generi attraverso l'imdbGenreMap (1:N)
function mapGenresToInternal(genres = []) {
  const out = [];
  for (const genre of genres) {
    if (!genre) continue;
    out.push(...mapGenreToInternal(genre));
  }
  return sanitizeGenres(out);
}

const LEADING_ARTICLE_REGEX =
  /^(?:l['’]|il|lo|la|i|gli|le|un|uno|una|the|a|an)(?:[\s\u00A0'’\-]+|$)/i;

function removeArticles(rawTitle = '') {
  if (typeof rawTitle !== 'string') return '';

  // Gestisce "L'" con apostrofo attaccato (L'era -> era)
  const apostropheTest = rawTitle.match(/^l[\u0027\u2019](\w+)/i);
  if (apostropheTest) {
    return apostropheTest[1];
  }

  const sanitized = (rawTitle.normalize ? rawTitle.normalize('NFC') : rawTitle)
    .replace(/^[\s\u00A0\u00AD\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F\u3000\uFEFF\u2060\u3164\u2800"'“”‘’«»]+/, '')
    .trimStart();

  if (!sanitized) return '';

  const match = sanitized.match(LEADING_ARTICLE_REGEX);
  if (match) {
    const remainder = sanitized
      .slice(match[0].length)
      .replace(/^[\-\s\u00A0'’]+/, '')
      .trim();
    if (remainder) {
      return remainder;
    }
  }

  return sanitized;
}

function stripParens(str) {
  if (!str) return '';
  return str.replace(/\s*\([^)]*\)/g, '').trim();
}

const IGNORED_GENRE_TOKENS = new Set([
  'torna all\'inizio',
  'torna all’inizio',
  'Torna all\'inizio',
  'Torna all’inizio',
]);

function sanitizeGenres(list = []) {
  return list
    .map((g) => (typeof g === 'string' ? g.trim() : ''))
    .filter((g) => g && !IGNORED_GENRE_TOKENS.has(g.toLowerCase()));
}

function sortGenresAlphabetically(genres = []) {
  return [...genres].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
}

async function copyToClipboard(text, setCopyState, key) {
  try {
    await navigator.clipboard.writeText(text || '');
    setCopyState((prev) => ({ ...prev, [key]: 'success' }));
    setTimeout(
      () =>
        setCopyState((prev) => {
          const { [key]: _, ...rest } = prev;
          return rest;
        }),
      2000
    );
  } catch (err) {
    console.error('Errore nella copia:', err);
    setCopyState((prev) => ({ ...prev, [key]: 'error' }));
    setTimeout(
      () =>
        setCopyState((prev) => {
          const { [key]: _, ...rest } = prev;
          return rest;
        }),
      2000
    );
  }
}

// ====== GOOGLE AI: generazione generi con timeout + retry (solo on demand) ======
async function getAiGenres(title, overview, genres, existingCollectionGenres) {
  if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'LA_TUA_CHIAVE_API_GEMINI_QUI') {
    console.warn('Chiave API Google non impostata. Salto i generi AI.');
    return [];
  }

  const existingGenresString =
    existingCollectionGenres && existingCollectionGenres.length > 0
      ? existingCollectionGenres.join(', ')
      : 'Nessuno';

  const prompt = `
Procedi per step e verifica bene prima di darmi la risposta che tutto sia in linea con ogni elemento della presente specifica.
Sei un catalogatore di film per Plex. Il tuo compito è generare 5-8 sotto-generi MOLTO specifici.

DATI DEL FILM:
- Titolo: ${title}
- Trama: ${overview}
- Generi generici da ignorare: ${genres.join(', ')}

---
COMPITO 1: VALIDAZIONE
Generi già identificati in questa collezione: [${existingGenresString}]
Analizza il film e decidi quali (se presenti) di questi generi della collezione si applicano ANCHE a questo film specifico.
---
COMPITO 2: GENERAZIONE
Genera 2-4 nuovi generi di nicchia SPECIFICI per questo film, che non siano già nella lista della collezione o nei generi generici.

---
REGOLE ASSOLUTE:
1.  **FORMATO:** Restituisci SOLO un elenco di generi di nicchia, separati da virgola.
2.  **NON USARE GENERI GENERICI:** Il tuo output NON DEVE contenere generi di base come "Azione", "Commedia", "Dramma", "Animazione", "Fantasy", "Avventura", "Famiglia", "Romantico".
3.  **LINGUA ITALIANA:** Usa la traduzione italiana. (Esempio: Se pensi a "Coming-of-Age", DEVI usare "Formazione").
4.  **SEPARAZIONE (IMPORTANTE):** Se un genere è composto da "e" (es. "Cappa e Spada" o "Spade e Stregoneria"), DEVI splittarlo in due generi separati. (Esempio: "Cappa e Spada" -> "Cappa, Spada").
5.  **QUALITÀ (NON FRASI):** Usa generi REALI. (Esempio: "Fiaba" va bene. "Musical" va bene). NON usare frasi descrittive. (Esempio: "Fiaba di Desideri" è SBAGLIATO. "Intrighi di palazzo" è SBAGLIATO, "Storia di Vendetta" è sbagliato. Non devono essere tag devono essere GENERI CINEMATOGRAFICI). Verifica e ricontrolla sempre se un genere identificato si addice veramente al film oggetto di analisi.
    -   **SÌ (Generi):** Heist Movie, Slasher, Cyberpunk, Body Horror, Legal Thriller, Found Footage, Commedia Nera, Biografico, Gangster Movie, Musicale, Arti Marziali, Mockumentary, Fantapolitica, Dramma giudiziario, Formazione, Fiaba, Cappa, Spada, Animali, Vendetta, Desideri, Intrighi.
    -   **NO (Frasi/Temi):** Animali parlanti, Intrighi di palazzo, Storia di Vendetta, Fiaba di Desideri.

Restituisci SOLO l'elenco dei nuovi generi, attinenti al film analizzato, dopo aver verificato che i generi generati siano effettivamente dei validi generi cinematografici. Se non si tratta di generi cinematografici validi non hai svolto correttamente il compito e devi rifare l'attività fino a quando non avrai generato una risposta valida.
`;

  const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;
  const apiUrl = CORS_PROXY + encodeURIComponent(googleUrl);

  try {
    const response = await fetchWithTimeoutAndRetry(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      },
      {
        timeoutMs: 15000,
        retries: 2,
        backoffMs: 2000,
        logPrefix: '[GoogleAI] ',
      }
    );

    const data = await response.json();

    if (
      !data.candidates ||
      !data.candidates[0] ||
      !data.candidates[0].content ||
      !data.candidates[0].content.parts ||
      !data.candidates[0].content.parts[0]
    ) {
      console.error('Risposta AI in formato inatteso:', data);
      throw new Error('Formato risposta AI non valido.');
    }

    const aiText = data.candidates[0].content.parts[0].text || '';

    return aiText
      .replace(/\n/g, '')
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g);
  } catch (error) {
    console.error('Errore durante la chiamata a Google AI:', error);
    return [];
  }
}

// ====== IMDb SCRAPER (usa il backend HTML) ======
async function fetchImdbScraped(imdbId) {
  if (!imdbId) {
    throw new Error('IMDb ID mancante');
  }

  const url = `${IMDB_SCRAPER_BASE_URL}/api/imdb/${encodeURIComponent(
    imdbId
  )}`;

  const res = await fetchWithTimeoutAndRetry(
    url,
    { method: 'GET' },
    { timeoutMs: 15000, retries: 1, backoffMs: 2000, logPrefix: '[IMDbScraper] ' }
  );

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data; // { imdbId, chips, directors, writers }
}

// ====== COMPONENTE: ImdbScraper ======
function ImdbScraper({ imdbId, onData }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
  let cancelled = false;

  async function run() {
    if (!imdbId) return;
    setError('');
    setLoading(true);
    try {
      const data = await fetchImdbScraped(imdbId);
      if (cancelled) return;
      const sanitizedData = {
        ...data,
        chips: sanitizeGenres(data.chips || []),
      };
      setResult(sanitizedData);
      // onData NON entra più nelle dipendenze, ma viene comunque chiamato qui
      onData && onData(sanitizedData);
    } catch (err) {
      if (cancelled) return;
      console.error(err);
      setError(err.message || 'Errore nel recupero dati IMDb');
    } finally {
      if (!cancelled) setLoading(false);
    }
  }

  run();

  return () => {
    cancelled = true;
  };
}, [imdbId]);


  return (
    <div className="genre-editor" style={{ marginTop: 20 }}>
      <div className="genre-editor-label">
        🎬 Dati aggiuntivi da IMDb (scraper HTML)
      </div>

      {imdbId ? (
        <div className="genre-help">
          IMDb ID da TMDB: <code>{imdbId}</code>
        </div>
      ) : (
        <div className="genre-help">Nessun IMDb ID disponibile da TMDB.</div>
      )}

      {loading && (
        <div className="genre-help">Scraping IMDb in corso...</div>
      )}

      {error && <div className="error">{error}</div>}

      {result && (
        <div style={{ marginTop: 10, fontSize: '0.9em', color: '#444' }}>
          <div>
            <strong>IMDb ID:</strong> {result.imdbId}
          </div>
          <div>
            <strong>Chip IMDb (interessi):</strong>{' '}
            {result.chips && result.chips.length > 0
              ? result.chips.join(', ')
              : 'N/A'}
          </div>
          <div>
            <strong>Registi IMDb (scraper):</strong>{' '}
            {result.directors?.join(', ') || 'N/A'}
          </div>
          <div>
            <strong>Autori IMDb (scraper):</strong>{' '}
            {result.writers?.join(', ') || 'N/A'}
          </div>
        </div>
      )}
    </div>
  );
}

// ====== COMPONENTE PRINCIPALE ======
export default function App() {
  const [type, setType] = useState(''); // 'collection' | 'movie'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [resultsVisible, setResultsVisible] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Caricamento in corso...');
  const [error, setError] = useState('');

  const [currentCollection, setCurrentCollection] = useState(null);
  const [collectionGenres, setCollectionGenres] = useState([]);
  const [collectionGenresInput, setCollectionGenresInput] = useState('');
  const [copyState, setCopyState] = useState({});

  const [collectionDetailsView, setCollectionDetailsView] = useState(null);
  const [movieDetailsView, setMovieDetailsView] = useState(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  
  const [collectionCycleIndex, setCollectionCycleIndex] = useState(0);
  const [movieCycleIndex, setMovieCycleIndex] = useState(0);

  const hasTmdbConfig = !!TMDB_BEARER_TOKEN;

  const handleSelectType = (newType) => {
    setType(newType);
    setCurrentCollection(null);
    setCollectionGenres([]);
    setCollectionGenresInput('');
    setResults([]);
    setResultsVisible(false);
    setCollectionDetailsView(null);
    setMovieDetailsView(null);
    setQuery('');
    setError('');
    setAiError('');
  };

  // ====== RICERCA TMDB ======
  const handleSearch = async () => {
    if (!query.trim()) {
      setError('Inserisci un termine di ricerca');
      return;
    }
    if (!type) {
      setError('Seleziona prima "Collezione" o "Film"');
      return;
    }
    if (!hasTmdbConfig) {
      setError(
        'Configura la chiave TMDB (VITE_TMDB_BEARER_TOKEN) prima di usare la ricerca.'
      );
      return;
    }

    setError('');
    setLoading(true);
    setLoadingText('Caricamento in corso...');
    setResultsVisible(false);
    setResults([]);

    try {
      const endpoint = type === 'collection' ? 'search/collection' : 'search/movie';

      const res = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/${endpoint}?query=${encodeURIComponent(query)}&include_adult=true&language=it-IT&page=1`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.error('Errore dettagliato ricerca:', text);
        throw new Error('Errore nella ricerca TMDB');
      }

      const data = await res.json();
      setResults(data.results || []);
      setResultsVisible(true);
    } catch (err) {
      console.error(err);
      setError(
        'Errore durante la ricerca: ' +
          (err.message || 'vedi console per maggiori dettagli')
      );
    } finally {
      setLoading(false);
    }
  };

  // ====== DETTAGLI COLLEZIONE ======
  const loadCollectionDetails = async (id) => {
    if (!hasTmdbConfig) return;

    setLoading(true);
    setLoadingText('Caricamento dettagli collezione...');
    setError('');
    setMovieDetailsView(null);

    try {
      const resIT = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/collection/${id}?language=it-IT`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!resIT.ok) throw new Error('Errore dettagli collezione (IT)');
      const dataIT = await resIT.json();

      if (!dataIT.overview || !dataIT.overview.trim()) {
        const resEN = await fetch(
          `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/collection/${id}?language=en-US`,
          {
            headers: {
              Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (resEN.ok) {
          const dataEN = await resEN.json();
          if (dataEN.overview && dataEN.overview.trim()) {
            dataIT.overview = dataEN.overview;
          }
        }
      }

      setCurrentCollection(dataIT);
      setCollectionGenres([]);
      setCollectionGenresInput('');
      const collectionView = await buildCollectionView(dataIT, []);
      setCollectionDetailsView(collectionView);
    } catch (err) {
      console.error(err);
      setError(
        'Errore nel recupero dei dettagli della collezione: ' +
          (err.message || '')
      );
    } finally {
      setLoading(false);
    }
  };

  async function buildCollectionView(collection, genres) {
    const numeroFilm = collection.parts ? collection.parts.length : 0;
    let titolo = collection.name
      ? collection.name.replace(/Collection|Collezione/gi, 'Raccolta')
      : 'Titolo non disponibile';
    const titoloOrdinamento = removeArticles(titolo);

    const overview =
      collection.overview && collection.overview.trim()
        ? collection.overview.trim()
        : '';
    
    // Traduci il riassunto se non è vuoto
    const originalRiassunto = overview || '';
    let riassunto = originalRiassunto;
    if (riassunto) {
      try {
        const translated = await translateToItalian(riassunto);
        riassunto = translated || originalRiassunto; // Fallback al testo originale
      } catch (error) {
        console.error('Errore traduzione riassunto collezione:', error);
        riassunto = originalRiassunto; // Mantiene il testo originale in caso di errore
      }
    }

    return {
      titolo,
      titoloOrdinamento,
      riassunto,
      posterPath: collection.poster_path || null,
      numeroFilm,
      parts:
        collection.parts
          ?.slice()
          .sort((a, b) => {
            const dateA = a.release_date || null;
            const dateB = b.release_date || null;
            
            // Se entrambi hanno data, ordina per data
            if (dateA && dateB) {
              return new Date(dateA) - new Date(dateB);
            }
            
            // Se solo A non ha data, metti A dopo B
            if (!dateA && dateB) {
              return 1;
            }
            
            // Se solo B non ha data, metti B dopo A
            if (dateA && !dateB) {
              return -1;
            }
            
            // Se entrambi non hanno data, ordina alfabeticamente per titolo
            const titleA = (a.title || '').toLowerCase();
            const titleB = (b.title || '').toLowerCase();
            return titleA.localeCompare(titleB, 'it');
          }) || [],
      collectionGenres: genres,
    };
  }

  const handleCollectionGenresChange = (value) => {
    setCollectionGenresInput(value);
    const arr = sortGenresAlphabetically(
      Array.from(
        new Set(
          sanitizeGenres(
            value
              .split(',')
              .map((g) => g.trim())
              .filter((g) => g.length > 0)
          )
        )
      )
    );
    setCollectionGenres(arr);
    if (currentCollection) {
      buildCollectionView(currentCollection, arr).then(setCollectionDetailsView);
    }
  };

  const appendGenresToCollection = (newGenres) => {
    if (!currentCollection || !newGenres || newGenres.length === 0) return;

    const sanitizedNewGenres = sanitizeGenres(newGenres);
    if (sanitizedNewGenres.length === 0) return;

    setCollectionGenres((prev) => {
      const set = new Set(prev);
      sanitizedNewGenres.forEach((g) => {
        if (g) set.add(g);
      });
      const arr = sortGenresAlphabetically([...set]);

      if (arr.length === prev.length) {
        return prev;
      }

      buildCollectionView(currentCollection, arr).then(setCollectionDetailsView);
      setCollectionGenresInput(arr.join(', '));
      return arr;
    });
  };

  const removeGenreFromCollection = (genreToRemove) => {
    if (!currentCollection) return;
    setCollectionGenres((prev) => {
      const arr = prev.filter((g) => g !== genreToRemove);
      buildCollectionView(currentCollection, arr).then(setCollectionDetailsView);
      setCollectionGenresInput(arr.join(', '));
      return arr;
    });
  };


  // ====== DETTAGLI FILM ======
  const loadMovieDetails = async (id, isInCollection) => {
    if (!hasTmdbConfig) return;

    setLoading(true);
    setLoadingText('Caricamento dettagli film...');
    setError('');
    setAiError('');

    try {
      const movieResponseIT = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/movie/${id}?language=it-IT`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!movieResponseIT.ok)
        throw new Error('Errore nel recupero dei dettagli IT');
      const movieIT = await movieResponseIT.json();

      const movieResponseEN = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/movie/${id}?language=en-US`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!movieResponseEN.ok)
        throw new Error('Errore nel recupero dei dettagli EN');
      const movieEN = await movieResponseEN.json();

      const creditsResponse = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/movie/${id}/credits?language=it-IT`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const credits = creditsResponse.ok
        ? await creditsResponse.json()
        : { cast: [], crew: [] };

      const releasesResponse = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/movie/${id}/release_dates`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const releases = releasesResponse.ok
        ? await releasesResponse.json()
        : { results: [] };

      const externalIdsResponse = await fetch(
        `${IMDB_SCRAPER_BASE_URL}/api/tmdb-proxy/movie/${id}/external_ids`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const externalIds = externalIdsResponse.ok
        ? await externalIdsResponse.json()
        : {};
      const imdbId = externalIds.imdb_id || null;

      // Salva snapshot collezione PRIMA di aggiungere i generi del film
      const collectionGenresSnapshot = [...collectionGenres];

      const vm = await buildMovieViewModel({
        movieIT,
        movieEN,
        credits,
        releases,
        currentCollection,
        collectionGenres: collectionGenresSnapshot,
        imdbId,
      });

      // aggiorna automaticamente i Generi Condivisi della Collezione con i generi TMDB del film
      if (vm.generiTmdb && vm.generiTmdb.length > 0) {
        appendGenresToCollection(vm.generiTmdb);
      }

      setMovieDetailsView({
        ...vm,
        isInCollection,
        collectionGenresSnapshot, // Salva lo snapshot nel view per il render
      });
    } catch (err) {
      console.error(err);
      setError(
        'Errore nel caricamento dei dettagli del film: ' +
          (err.message || '')
      );
    } finally {
      setLoading(false);
    }
  };

  async function buildMovieViewModel({
    movieIT,
    movieEN,
    credits,
    releases,
    currentCollection,
    collectionGenres,
    imdbId,
  }) {
    let titolo = movieIT.title || movieEN.title || "Titolo non disponibile";
    let titoloOrdinamento = "";

    if (currentCollection && currentCollection.parts) {
      let collectionName = currentCollection.name
        .replace(/Collection/gi, "")
        .replace(/Collezione/gi, "")
        .replace(/Raccolta/gi, "")
        .trim();
      collectionName = collectionName.replace(/[\s-]+$/, "").trim();
      const firstWord = collectionName.split(" ")[0];

      if (!titolo.startsWith(firstWord)) {
        titolo = `${collectionName} - ${titolo}`;
      }

      const sortedParts =
        currentCollection.parts?.slice().sort((a, b) => {
          const dateA = a.release_date || null;
          const dateB = b.release_date || null;

          // Se entrambi hanno data, ordina per data
          if (dateA && dateB) {
            return new Date(dateA) - new Date(dateB);
          }

          // Se solo A non ha data, metti A dopo B
          if (!dateA && dateB) {
            return 1;
          }

          // Se solo B non ha data, metti B dopo A
          if (dateA && !dateB) {
            return -1;
          }

          // Se entrambi non hanno data, ordina alfabeticamente per titolo
          const titleA = (a.title || "").toLowerCase();
          const titleB = (b.title || "").toLowerCase();
          return titleA.localeCompare(titleB, "it");
        }) || [];

      let movieIndex = sortedParts.findIndex((p) => p.id === movieIT.id) + 1;
      if (movieIndex <= 0) movieIndex = 1;

      const orderingBase = `${collectionName} ${movieIndex}`.trim();
      const cleanedOrdering = removeArticles(orderingBase);
      titoloOrdinamento = cleanedOrdering || orderingBase;
    } else {
      const cleanedTitle = removeArticles(titolo);
      titoloOrdinamento = cleanedTitle || titolo;
    }

    const titoloOriginale =
      movieIT.original_title || movieEN.original_title || "";

    // Usa la data principale del film da TMDB (release_date è la data ufficiale)
    let dataUscita = movieIT.release_date || movieEN.release_date || "";

    // Cerca la release italiana (serve anche per la classificazione)
    const italianRelease = releases.results.find((r) => r.iso_3166_1 === "IT");

    // Se non c'è data principale, cerca nelle release dates specifiche per paese
    if (!dataUscita && releases.results && releases.results.length > 0) {
      // Prova prima con la release italiana
      if (
        italianRelease &&
        italianRelease.release_dates &&
        italianRelease.release_dates.length > 0
      ) {
        const theatricalRelease =
          italianRelease.release_dates.find((r) => r.type === 3) ||
          italianRelease.release_dates[0];
        if (theatricalRelease?.release_date) {
          dataUscita = theatricalRelease.release_date.split("T")[0];
        }
      }

      // Se ancora non c'è, cerca in qualsiasi paese con theatrical release
      if (!dataUscita) {
        for (const countryRelease of releases.results) {
          if (
            countryRelease.release_dates &&
            countryRelease.release_dates.length > 0
          ) {
            const theatrical = countryRelease.release_dates.find(
              (r) => r.type === 3
            );
            if (theatrical?.release_date) {
              dataUscita = theatrical.release_date.split("T")[0];
              break;
            }
          }
        }
      }
    }

    let classificazione = "";
    if (italianRelease && italianRelease.release_dates) {
      const releaseWithCert = italianRelease.release_dates.find(
        (r) => r.certification
      );
      if (releaseWithCert?.certification) {
        classificazione = releaseWithCert.certification;
      }
    }
    if (!classificazione) {
      const usRelease = releases.results.find((r) => r.iso_3166_1 === "US");
      if (usRelease && usRelease.release_dates) {
        const releaseWithCert = usRelease.release_dates.find(
          (r) => r.certification
        );
        if (releaseWithCert?.certification) {
          classificazione = releaseWithCert.certification;
        }
      }
    }
    const contentRating =
      classificazione || (movieIT.adult ? "R (Adulti)" : "Non disponibile");

    const studio =
      (movieIT.production_companies && movieIT.production_companies[0]?.name) ||
      (movieEN.production_companies && movieEN.production_companies[0]?.name) ||
      "";

    // Traduci la tagline se non è vuota
    const originalTagline = movieIT.tagline || movieEN.tagline || "";
    let tagline = originalTagline;
    if (tagline) {
      try {
        const translatedTagline = await translateToItalian(tagline);
        tagline = translatedTagline || originalTagline; // Fallback al testo originale
      } catch (error) {
        console.error("Errore traduzione tagline film:", error);
        tagline = originalTagline; // Mantiene il testo originale in caso di errore
      }
    }

    // Traduci il riassunto se non è in italiano
    const originalRiassunto = movieIT.overview || movieEN.overview || "";
    let riassunto = originalRiassunto;
    if (riassunto) {
      try {
        const translated = await translateToItalian(riassunto);
        riassunto = translated || originalRiassunto; // Fallback al testo originale
      } catch (error) {
        console.error("Errore traduzione riassunto film:", error);
        riassunto = originalRiassunto; // Mantiene il testo originale in caso di errore
      }
    }

    const directors = credits.crew.filter((c) => c.job === "Director");
    const writers = credits.crew.filter((c) => c.department === "Writing");
    const producers = credits.crew.filter(
      (c) => c.job === "Producer" || c.job === "Executive Producer"
    );

    const paesi = (
      movieIT.production_countries && movieIT.production_countries.length > 0
        ? movieIT.production_countries
        : movieEN.production_countries || []
    ).map((p) => p.name);

    const isItalianFilm =
      movieIT.original_language === "it" || paesi.includes("Italy");

    // generi TMDB mappati attraverso imdbGenreMap
    const rawTmdbGenres = (
      movieIT.genres && movieIT.genres.length > 0
        ? movieIT.genres
        : movieEN.genres || []
    )
      .map((g) => g.name)
      .filter(Boolean);
    let generiTmdb = mapGenresToInternal(rawTmdbGenres);

    if (generiTmdb.includes("Commedia") && generiTmdb.includes("Romantico")) {
      generiTmdb.push("Commedia Romantica");
    }
    if (isItalianFilm && !generiTmdb.includes("Italiano")) {
      generiTmdb.push("Italiano");
    }

    const generiTmdbSanitized = sanitizeGenres(generiTmdb);
    // applica il mapping anche ai generi della collezione
    const mappedCollectionGenres = mapGenresToInternal(collectionGenres);
    const collectionGenresSanitized = sanitizeGenres(mappedCollectionGenres);
    const generiAiSanitized = sanitizeGenres([]); // popolati dopo dall'AI

    // generi propri del film (senza quelli della collezione)
    const movieSpecificGenres = sanitizeGenres([
      ...new Set([...generiTmdbSanitized, ...generiAiSanitized]),
    ]);

    // tutti i generi: collezione + film, univoci + ordine alfabetico
    const allGenresSorted = sanitizeGenres([
      ...new Set([...collectionGenresSanitized, ...movieSpecificGenres]),
    ]).sort((a, b) => a.localeCompare(b, "it"));

    return {
      titolo,
      titoloOrdinamento,
      titoloOriginale,
      dataUscita,
      contentRating,
      studio,
      tagline,
      riassunto,
      directors,
      writers,
      producers,
      paesi,
      posterPath: movieIT.poster_path || movieEN.poster_path || null,
      movieIT,
      movieEN,

      // generi originali separati
      generiTmdb: generiTmdbSanitized,
      generiImdb: [], // Inizializzato vuoto, popolato dopo da handleImdbData
      generiAi: generiAiSanitized,
      collectionGenres: collectionGenresSanitized,

      // generi calcolati
      movieSpecificGenres,
      allGenresSorted,
      generiBase: allGenresSorted,

      imdbData: null,
      imdbId,
    };
  }

  const handleImdbData = (imdbData) => {
    const imdbChips = imdbData?.chips || [];
    const imdbInternalGenres = mapGenresToInternal(imdbChips);

    // aggiorna generi condivisi della collezione con i generi interni derivati da IMDb
    if (imdbInternalGenres.length > 0) {
      appendGenresToCollection(imdbInternalGenres);
    }

    setMovieDetailsView((prev) => {
      if (!prev) return prev;

      const imdbDirectors = imdbData.directors || [];
      const imdbWriters = imdbData.writers || [];

      // generi derivati direttamente dal film (TMDB/IMDb/AI)
      const updatedMovieSpecific = sanitizeGenres([
        ...new Set([
          ...(prev.movieSpecificGenres || []),
          ...imdbInternalGenres,
        ]),
      ]);
      
      // Salva generi IMDb separatamente per la colorazione
      const generiImdbSanitized = sanitizeGenres(imdbInternalGenres);

      // tutti i generi: snapshot collezione + film, univoci + ordine alfabetico
      const allGenresSorted = sanitizeGenres([
        ...new Set([...(prev.collectionGenresSnapshot || []), ...updatedMovieSpecific]),
      ]).sort((a, b) => a.localeCompare(b, 'it'));

      const mergedDirectors = [
        ...new Set([
          ...prev.directors.map((d) => d.name || d),
          ...imdbDirectors,
        ]),
      ];
      const mergedWriters = [
        ...new Set([
          ...prev.writers.map((w) => w.name || w),
          ...imdbWriters,
        ]),
      ];

      return {
        ...prev,
        imdbData,
        generiImdb: generiImdbSanitized,
        movieSpecificGenres: updatedMovieSpecific,
        allGenresSorted,
        generiBase: allGenresSorted,
        directorsMerged: mergedDirectors,
        writersMerged: mergedWriters,
      };
    });
  };

  const handleAiAnalyze = async () => {
    if (!movieDetailsView) return;
    const { titolo, riassunto, generiTmdb } = movieDetailsView;

    setAiError('');
    setAiLoading(true);

    try {
      const aiGenresRaw = await getAiGenres(
        titolo,
        riassunto,
        generiTmdb || [],
        collectionGenres
      );

      const aiGenres = sanitizeGenres(aiGenresRaw);

      if (!aiGenres || aiGenres.length === 0) {
        setAiError('Nessun genere AI generato.');
      }

      // aggiorna dettagli film
      setMovieDetailsView((prev) => {
        if (!prev) return prev;

        const updatedMovieSpecific = sanitizeGenres([
          ...new Set([
            ...(prev.movieSpecificGenres || []),
            ...aiGenres,
          ]),
        ]);

        const allGenresSorted = sanitizeGenres([
          ...new Set([...(prev.collectionGenresSnapshot || []), ...updatedMovieSpecific]),
        ]).sort((a, b) => a.localeCompare(b, 'it'));

        return {
          ...prev,
          generiAi: aiGenres,
          movieSpecificGenres: updatedMovieSpecific,
          allGenresSorted,
          generiBase: allGenresSorted,
        };
      });

      // aggiorna generi condivisi collezione
      if (aiGenres && aiGenres.length > 0) {
        appendGenresToCollection(aiGenres);
      }
    } catch (err) {
      console.error(err);
      setAiError(err.message || 'Errore durante analisi AI');
    } finally {
      setAiLoading(false);
    }
  };

  // ====== RENDER HELPERS ======
  const renderCopyButton = (key, text, syncCyclicIndex) => {
    const state = copyState[key];
    const label =
      state === 'success' ? '✅' : state === 'error' ? '❌' : '📋';
    return (
      <button
        className={`copy-button ${state === 'success' ? 'copied' : ''}`}
        onClick={() => {
          copyToClipboard(text, setCopyState, key);
          if (syncCyclicIndex) syncCyclicIndex();
        }}
      >
        {label}
      </button>
    );
  };

  const syncCollectionCycleIndex = (fieldKey) => {
    if (!collectionDetailsView) return;
    const fieldMap = {
      'coll-titolo': 0,
      'coll-titolo-ord': 1,
      'coll-riassunto': 2,
    };
    if (fieldKey in fieldMap) {
      setCollectionCycleIndex(fieldMap[fieldKey] + 1);
    }
  };

  const handleCollectionCyclicCopy = () => {
    if (!collectionDetailsView) return;
    const { titolo, titoloOrdinamento, riassunto, numeroFilm, parts } = collectionDetailsView;
    
    let fullRiassunto = riassunto;
    if (parts && parts.length > 0) {
      fullRiassunto += '\nNumero di Film: ' + numeroFilm;
      parts.forEach((movie) => {
        const movieTitle = movie.title || 'Titolo non disponibile';
        const releaseYear = movie.release_date
          ? new Date(movie.release_date).getFullYear()
          : '';
        fullRiassunto += '\n✅ ' + movieTitle + (releaseYear ? ' (' + releaseYear + ')' : '');
      });
      fullRiassunto += '\n❌ Altro...';
    }
    
    const items = [
      { label: 'Titolo', value: titolo },
      { label: 'Titolo Ordinamento', value: removeArticles(titoloOrdinamento) },
      { label: 'Riassunto', value: fullRiassunto },
    ];
    const current = items[collectionCycleIndex % items.length];
    copyToClipboard(current.value, setCopyState, 'collection-cycle');
    setCollectionCycleIndex((prev) => prev + 1);
  };

  const syncMovieCycleIndex = (fieldKey) => {
    if (!movieDetailsView) return;
    const fieldMap = {
      'film-titolo': 0,
      'film-titolo-ord': 1,
      'film-titolo-orig': 2,
      'film-data-uscita': 3,
      'film-rating': 4,
      'film-studio': 5,
      'film-tagline': 6,
      'film-riassunto': 7,
      'film-registi': 8,
      'film-paesi': 9,
      'film-generi': 10,
      'film-autori': 11,
      'film-produttori': 12,
    };
    if (fieldKey in fieldMap) {
      setMovieCycleIndex(fieldMap[fieldKey] + 1);
    }
  };

  const handleMovieCyclicCopy = () => {
    if (!movieDetailsView) return;
    const {
      titolo,
      titoloOrdinamento,
      titoloOriginale,
      dataUscita,
      contentRating,
      studio,
      tagline,
      riassunto,
      directors,
      writers,
      producers,
      paesi,
      directorsMerged,
      writersMerged,
      allGenresSorted,
    } = movieDetailsView;

    const directorsArr = (directorsMerged && directorsMerged) || directors.map((d) => d.name);
    const writersArr = (writersMerged && writersMerged) || writers.map((w) => w.name);
    const directorsString = directorsArr.map(stripParens).join(', ');
    const writersString = writersArr.map(stripParens).join(', ');
    const producersString = producers.map((p) => stripParens(p.name)).filter(Boolean).join(', ');
    const paesiString = paesi.join(', ');
    const generiString = (allGenresSorted || []).join(', ');

    const items = [
      { label: 'Titolo', value: titolo },
      { label: 'Titolo Ordinamento', value: removeArticles(titoloOrdinamento) },
      { label: 'Titolo Originale', value: titoloOriginale },
      { label: 'Data Uscita', value: dataUscita || '' },
      { label: 'Classificazione', value: contentRating || '' },
      { label: 'Studio', value: studio || '' },
      { label: 'Tagline', value: tagline || '' },
      { label: 'Riassunto', value: riassunto || '' },
      { label: 'Registi', value: directorsString },
      { label: 'Paesi', value: paesiString },
      { label: 'Generi', value: generiString },
      { label: 'Autori', value: writersString },
      { label: 'Produttori', value: producersString },
    ].filter((item) => item.value);

    const current = items[movieCycleIndex % items.length];
    copyToClipboard(current.value, setCopyState, 'movie-cycle');
    setMovieCycleIndex((prev) => prev + 1);
  };

  const renderCollectionDetails = () => {
    if (!collectionDetailsView) return null;

    const {
      titolo,
      titoloOrdinamento,
      riassunto,
      posterPath,
      numeroFilm,
      parts,
      collectionGenres: genres,
    } = collectionDetailsView;

    return (
      <div className="collection-details">
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>📚 Dettagli Collezione</span>
          <button
            className="copy-button"
            onClick={handleCollectionCyclicCopy}
            title="Copia ciclico"
          >
            {copyState['collection-cycle'] === 'success' ? '✅' : '📋'}
          </button>
        </div>

        {posterPath && (
          <div className="poster-container">
            <img
              src={`https://image.tmdb.org/t/p/w300${posterPath}`}
              alt={titolo}
              className="poster-image"
            />
          </div>
        )}

        <div className="detail-section compact">
          <div className="detail-label">📖 Titolo</div>
          <div className="detail-value">
            <span className="detail-text">{titolo}</span>
            {renderCopyButton('coll-titolo', titolo, () => syncCollectionCycleIndex('coll-titolo'))}
          </div>
        </div>

        <div className="detail-section compact">
          <div className="detail-label">🔤 Titolo Ordinamento</div>
          <div className="detail-value">
            <span className="detail-text">{removeArticles(titoloOrdinamento)}</span>
            {renderCopyButton('coll-titolo-ord', removeArticles(titoloOrdinamento), () => syncCollectionCycleIndex('coll-titolo-ord'))}
          </div>
        </div>

        <div className="detail-section compact">
          <div className="detail-label">📝 Riassunto</div>
          <div className="detail-value">
            <span className="detail-text">
              {riassunto.split('\n').map((r, i) => (
                <React.Fragment key={i}>
                  {r}
                  <br />
                </React.Fragment>
              ))}
              {parts && parts.length > 0 && (
                <>
                  <br />
                  Numero di Film: {numeroFilm}
                  <br />
                  {parts.map((movie) => {
                    const movieTitle = movie.title || 'Titolo non disponibile';
                    const releaseYear = movie.release_date
                      ? new Date(movie.release_date).getFullYear()
                      : '';
                    return (
                      <React.Fragment key={movie.id}>
                        ✅ {movieTitle} {releaseYear ? `(${releaseYear})` : ''}<br />
                      </React.Fragment>
                    );
                  })}
                  <br />
                  ❌ Altro...
                </>
              )}
            </span>
            {renderCopyButton('coll-riassunto', (() => {
              let fullText = riassunto;
              if (parts && parts.length > 0) {
                fullText += '\nNumero di Film: ' + numeroFilm ;
                parts.forEach((movie) => {
                  const movieTitle = movie.title || 'Titolo non disponibile';
                  const releaseYear = movie.release_date
                    ? new Date(movie.release_date).getFullYear()
                    : '';
                  fullText += '\n✅ ' + movieTitle + (releaseYear ? ' (' + releaseYear + ')' : '');
                });
                fullText += '\n❌ Altro...';
              }
              return fullText;
            })(), () => syncCollectionCycleIndex('coll-riassunto'))}
          </div>
        </div>

        <div className="genre-editor">
          <div className="genre-editor-label">
            🏷️ Generi Condivisi della Collezione
          </div>
          <input
            type="text"
            className="genre-input"
            placeholder="Es: Fantasy, Avventura, Famiglia"
            value={collectionGenresInput}
            onChange={(e) => handleCollectionGenresChange(e.target.value)}
          />
          {collectionGenres && collectionGenres.length > 0 && (
            <div className="tags-container" style={{ marginTop: 10 }}>
              {collectionGenres.map((genre) => (
                <div className="tag" key={genre}>
                  <span className="tag-text">{genre}</span>
                  <button
                    className="copy-button"
                    onClick={() => removeGenreFromCollection(genre)}
                    title="Rimuovi genere"
                  >
                    ❌
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="genre-help">
            Inserisci i generi separati da virgola. Questi verranno aggiunti a
            tutti i film della collezione.
          </div>
        </div>

        {parts && parts.length > 0 && (
          <div className="detail-section" style={{ marginTop: 20 }}>
            <div className="detail-label">
              🎬 Film nella Collezione ({numeroFilm})
            </div>
            <div className="tags-container">
              {parts.map((movie, index) => {
                const movieTitle = movie.title || 'Titolo non disponibile';
                const releaseYear = movie.release_date
                  ? new Date(movie.release_date).getFullYear()
                  : '';
                return (
                  <div className="tag" key={movie.id}>
                    <span className="tag-text">
                      {index + 1}. {movieTitle}{' '}
                      {releaseYear ? `(${releaseYear})` : ''}
                    </span>
                    <button
                      className="copy-button"
                      onClick={() => loadMovieDetails(movie.id, true)}
                    >
                      📄
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMovieDetails = () => {
    if (!movieDetailsView) return null;

    const {
      titolo,
      titoloOrdinamento,
      titoloOriginale,
      dataUscita,
      contentRating,
      studio,
      tagline,
      riassunto,
      directors,
      writers,
      producers,
      paesi,
      posterPath,
      generiBase,
      generiTmdb = [],
      generiImdb = [],
      generiAi = [],
      movieSpecificGenres = [],
      allGenresSorted = [],
      imdbData,
      directorsMerged,
      writersMerged,
      imdbId,
      collectionGenresSnapshot = [],
    } = movieDetailsView;

    const paesiString = paesi.join(', ');
    const genresToShow =
      allGenresSorted && allGenresSorted.length > 0
        ? allGenresSorted
        : generiBase || [];
    
    // Generi del film = TMDB + IMDb remapped (movieSpecificGenres contiene già TMDB + IMDb)
    // Usa lo snapshot della collezione PRIMA del caricamento del film corrente
    const normalizeList = (list = []) =>
      (list || []).map((g) => normalizeKey(g)).filter(Boolean);
    const movieGenreSet = new Set(normalizeList(movieSpecificGenres || []));
    const collectionGenreSet = new Set(normalizeList(collectionGenresSnapshot));
    const tmdbGenreSet = new Set(normalizeList(generiTmdb || []));
    const imdbGenreSet = new Set(normalizeList(generiImdb || []));
    const generiString = genresToShow.join(', ');

    const directorsArr =
      (directorsMerged && directorsMerged) || directors.map((d) => d.name);
    const writersArr =
      (writersMerged && writersMerged) || writers.map((w) => w.name);

    const directorsString = directorsArr.map(stripParens).join(', ');
    const writersString = writersArr.map(stripParens).join(', ');
    const producersString = producers
      .map((p) => stripParens(p.name))
      .filter(Boolean)
      .join(', ');

    const imdbLinkId = (imdbData && imdbData.imdbId) || imdbId;

    return (
      <div className="movie-details">
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>🎥 Dettagli Film</span>
          <button
            className="copy-button"
            onClick={handleMovieCyclicCopy}
            title="Copia ciclico"
          >
            {copyState['movie-cycle'] === 'success' ? '✅' : '📋'}
          </button>
        </div>

        {posterPath && (
          <div className="poster-container">
            <img
              src={`https://image.tmdb.org/t/p/w300${posterPath}`}
              alt={titolo}
              className="poster-image"
            />
          </div>
        )}

        <div className="two-column">
          <div className="detail-section compact">
            <div className="detail-label">🎬 Titolo</div>
            <div className="detail-value">
              <span className="detail-text">{titolo}</span>
              {renderCopyButton('film-titolo', titolo, () => syncMovieCycleIndex('film-titolo'))}
            </div>
          </div>

          <div className="detail-section compact">
            <div className="detail-label">🔤 Titolo Ordinamento</div>
            <div className="detail-value">
              <span className="detail-text">{removeArticles(titoloOrdinamento)}</span>
              {renderCopyButton('film-titolo-ord', removeArticles(titoloOrdinamento), () => syncMovieCycleIndex('film-titolo-ord'))}
            </div>
          </div>
        </div>

        <div className="two-column">
          <div className="detail-section compact">
            <div className="detail-label">🌍 Titolo Originale</div>
            <div className="detail-value">
              <span className="detail-text">{titoloOriginale}</span>
              {renderCopyButton('film-titolo-orig', titoloOriginale, () => syncMovieCycleIndex('film-titolo-orig'))}
            </div>
          </div>

          <div className="detail-section compact">
            <div className="detail-label">📅 Data Uscita</div>
            <div className="detail-value">
              <span className="detail-text">
                {dataUscita || 'Non disponibile'}
              </span>
              {renderCopyButton('film-data-uscita', dataUscita || '', () => syncMovieCycleIndex('film-data-uscita'))}
            </div>
          </div>
        </div>

        <div className="two-column">
          <div className="detail-section compact">
            <div className="detail-label">⭐ Classificazione Contenuti</div>
            <div className="detail-value">
              <span className="detail-text">
                <span className="content-rating-badge">
                  {contentRating || 'N/D'}
                </span>
              </span>
              {renderCopyButton('film-rating', contentRating || '', () => syncMovieCycleIndex('film-rating'))}
            </div>
          </div>

          {studio && (
            <div className="detail-section compact">
              <div className="detail-label">🏢 Studio</div>
              <div className="detail-value">
                <span className="detail-text">{studio}</span>
                {renderCopyButton('film-studio', studio, () => syncMovieCycleIndex('film-studio'))}
              </div>
            </div>
          )}
        </div>

        {tagline && (
          <div className="detail-section compact">
            <div className="detail-label">💬 Tagline</div>
            <div className="detail-value">
              <span className="detail-text">{tagline}</span>
              {renderCopyButton('film-tagline', tagline, () => syncMovieCycleIndex('film-tagline'))}
            </div>
          </div>
        )}

        {riassunto && (
          <div className="detail-section compact">
            <div className="detail-label">📝 Riassunto</div>
            <div className="detail-value">
              <span className="detail-text">{riassunto}</span>
              {renderCopyButton('film-riassunto', riassunto, () => syncMovieCycleIndex('film-riassunto'))}
            </div>
          </div>
        )}

        <div className="two-column">
          {directorsString && (
            <div className="detail-section compact">
              <div className="detail-label">🎬 Registi (TMDB + IMDb)</div>
              <div className="detail-value">
                <span className="detail-text">{directorsString}</span>
                {renderCopyButton('film-registi', directorsString, () => syncMovieCycleIndex('film-registi'))}
              </div>
            </div>
          )}

          {paesiString && (
            <div className="detail-section compact">
              <div className="detail-label">🌍 Paese</div>
              <div className="detail-value">
                <span className="detail-text">{paesiString}</span>
                {renderCopyButton('film-paesi', paesiString, () => syncMovieCycleIndex('film-paesi'))}
              </div>
            </div>
          )}
        </div>

        {generiString && (
          <div className="detail-section compact">
            <div className="detail-label">
              🏷️ Generi (TMDB + Collezione + AI + IMDb chips)
            </div>
            <div className="detail-value">
              <span className="detail-text">
                {genresToShow.map((g, idx) => {
                  const normalized = normalizeKey(g);
                  const isMovieOnly =
                    movieGenreSet.has(normalized) &&
                    !collectionGenreSet.has(normalized);
                  const isCollectionOnly =
                    collectionGenreSet.has(normalized) &&
                    !movieGenreSet.has(normalized);
                  const isFromTmdb = tmdbGenreSet.has(normalized);
                  const isFromImdb = imdbGenreSet.has(normalized);
                  const label =
                    g + (idx < genresToShow.length - 1 ? ', ' : '');
                  
                  // Priorità: TMDB > IMDb
                  if (isFromTmdb) {
                    return (
                      <span key={g} style={{ color: '#2196F3', fontWeight: 'bold' }}>{label}</span>
                    );
                  }
                  if (isFromImdb) {
                    return (
                      <span key={g} style={{ color: '#FF9800' }}>{label}</span>
                    );
                  }
                  if (isMovieOnly) {
                    return (
                      <strong key={g}>{label}</strong>
                    );
                  }
                  if (isCollectionOnly) {
                    return (
                      <span key={g} className="collection-genre">{label}</span>
                    );
                  }
                  return <span key={g}>{label}</span>;
                })}
              </span>
              {renderCopyButton('film-generi', generiString, () => syncMovieCycleIndex('film-generi'))}
            </div>
          </div>
        )}

        <div className="two-column">
          {writersString && (
            <div className="detail-section compact">
              <div className="detail-label">✍️ Autori (TMDB + IMDb)</div>
              <div className="detail-value">
                <span className="detail-text">{writersString}</span>
                {renderCopyButton('film-autori', writersString, () => syncMovieCycleIndex('film-autori'))}
              </div>
            </div>
          )}

          {producersString && (
            <div className="detail-section compact">
              <div className="detail-label">💼 Produttori</div>
              <div className="detail-value">
                <span className="detail-text">{producersString}</span>
                {renderCopyButton('film-produttori', producersString, () => syncMovieCycleIndex('film-produttori'))}
              </div>
            </div>
          )}
        </div>

        {/* Bottone AI on-demand */}
        <div className="detail-section compact" style={{ marginTop: 10 }}>
          <button
            className="search-button"
            style={{ padding: '10px 20px', fontSize: '0.95em' }}
            onClick={handleAiAnalyze}
            disabled={aiLoading}
          >
            {aiLoading ? 'Analisi AI in corso...' : 'Analizza generi con AI'}
          </button>
          {aiError && (
            <div className="error" style={{ marginTop: 8 }}>
              {aiError}
            </div>
          )}
        </div>

        {/* Scraper IMDb automatico */}
        <ImdbScraper imdbId={imdbId} onData={handleImdbData} />

        {imdbLinkId && (
          <div style={{ marginTop: 10, fontSize: '0.9em', color: '#555' }}>
            <strong>Link IMDb: </strong>
            <a
              href={`https://www.imdb.com/title/${imdbLinkId}/`}
              target="_blank"
              rel="noreferrer"
            >
              https://www.imdb.com/title/{imdbLinkId}/
            </a>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container">
      <div className="header">
        <h1>🎬 TMDB to Plex Manager (React)</h1>
        <p>Recupera informazioni da TMDB per Film e Collezioni</p>
        <p
          style={{
            fontSize: '0.9em',
            opacity: 0.8,
            marginTop: 10,
          }}
        >
          Utilizza un proxy CORS per le richieste API • Se non funziona, prova
          con un server locale
        </p>
      </div>

      <div className="content">
        <div className="type-selector">
          <button
            className={`type-button ${type === 'collection' ? 'active' : ''}`}
            onClick={() => handleSelectType('collection')}
          >
            📚 Collezione
          </button>
          <button
            className={`type-button ${type === 'movie' ? 'active' : ''}`}
            onClick={() => handleSelectType('movie')}
          >
            🎥 Film
          </button>
        </div>

        {type && (
          <div className="search-container active" id="searchContainer">
            <div className="search-box">
              <input
                type="text"
                className="search-input"
                placeholder={
                  type === 'collection'
                    ? 'Cerca una collezione (es. Aladdin, Harry Potter...)'
                    : 'Cerca un film (es. Avatar, Inception...)'
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
              />
              <button
                className="search-button"
                onClick={handleSearch}
                disabled={loading}
              >
                Cerca
              </button>
            </div>

            <div
              className={`results-list ${
                resultsVisible ? 'active' : ''
              }`}
              id="resultsList"
            >
              {!results || results.length === 0 ? (
                <div className="result-item">Nessun risultato</div>
              ) : (
                results.map((item) => {
                  const title =
                    type === 'collection' ? item.name : item.title;
                  const originalTitle =
                    type === 'collection'
                      ? item.original_name
                      : item.original_title;
                  const releaseDate =
                    type === 'movie'
                      ? item.release_date || 'Data sconosciuta'
                      : '';
                  return (
                    <div
                      className="result-item"
                      key={item.id}
                      onClick={() =>
                        type === 'collection'
                          ? loadCollectionDetails(item.id)
                          : loadMovieDetails(item.id, false)
                      }
                    >
                      <div className="result-title">
                        {title || 'Titolo non disponibile'}
                      </div>
                      <div className="result-info">
                        {originalTitle ? `Titolo originale: ${originalTitle}` : ''}
                        {releaseDate ? ` • ${releaseDate}` : ''}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div
          className={`details-container ${
            collectionDetailsView || movieDetailsView ? 'active' : ''
          }`}
          id="detailsContainer"
        >
          {renderCollectionDetails()}
          {renderMovieDetails()}
        </div>

        {loading && (
          <div id="loadingContainer" className="loading">
            <div className="loading-spinner"></div>
            <p>{loadingText}</p>
          </div>
        )}

        {error && (
          <div id="errorContainer">
            <div className="error">{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
