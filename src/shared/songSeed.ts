import type { SongCategory, SongItem } from './types.ts';

export const SEED_SONGS: SongItem[] = [
  // Latest Hindi (verified embeddable karaoke tracks)
  {
    id: 'latest-khat',
    videoId: '_413tvfCPNo',
    title: 'Khat (Karaoke with Lyrics)',
    artist: 'Navjot Ahuja',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 318,
  },
  {
    id: 'latest-o-sanam-akhil',
    videoId: 'aajApdFVmu0',
    title: 'O Sanam (Karaoke)',
    artist: 'Akhil Sachdeva, Vaibhav Pani',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 287,
  },
  {
    id: 'latest-jo-tum-mere-ho',
    videoId: '1-tcUuQ0fGs',
    title: 'Jo Tum Mere Ho (Karaoke)',
    artist: 'Anuv Jain',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 252,
  },
  {
    id: 'latest-sahiba',
    videoId: 'pI08FgtRRK4',
    title: 'Sahiba (Karaoke with Lyrics)',
    artist: 'Aditya Rikhari',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 211,
  },
  {
    id: 'latest-ishq',
    videoId: 'BsIvgQr4hPg',
    title: 'Ishq (Karaoke with Lyrics)',
    artist: 'Faheem Abdullah, Rauhan Malik',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 227,
  },
  {
    id: 'latest-sajni',
    videoId: 'Up7joV6zqs4',
    title: 'Sajni (Laapataa Ladies Acoustic Karaoke)',
    artist: 'Arijit Singh',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 175,
  },
  {
    id: 'latest-aaj-ki-raat',
    videoId: 'tSonRhPvONs',
    title: 'Aaj Ki Raat - Stree 2 (Karaoke)',
    artist: 'Sachin-Jigar, Madhubanti Bagchi',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 228,
  },
  {
    id: 'latest-husn',
    videoId: 'MpcjAkbIzdo',
    title: 'Husn (Karaoke with Lyrics)',
    artist: 'Anuv Jain',
    language: 'Hindi',
    category: 'Latest Hindi',
    durationSec: 218,
  },

  // Bollywood (verified karaoke / instrumental backing tracks)
  {
    id: 'bollywood-tum-hi-ho',
    videoId: 'I5-4eRqxG64',
    title: 'Tum Hi Ho (Karaoke)',
    artist: 'Arijit Singh',
    language: 'Hindi',
    category: 'Bollywood',
    durationSec: 262,
  },
  {
    id: 'bollywood-kesariya',
    videoId: 'k3ZjN3XSMBE',
    title: 'Kesariya (Karaoke)',
    artist: 'Arijit Singh, Pritam',
    language: 'Hindi',
    category: 'Bollywood',
    durationSec: 268,
  },
  {
    id: 'bollywood-channa-mereya',
    videoId: 'vlsoqMJDsjM',
    title: 'Channa Mereya (Karaoke)',
    artist: 'Arijit Singh',
    language: 'Hindi',
    category: 'Bollywood',
    durationSec: 289,
  },
  {
    id: 'bollywood-kal-ho-naa-ho',
    videoId: 's0lm5EKhiPs',
    title: 'Kal Ho Naa Ho (Karaoke)',
    artist: 'Sonu Nigam',
    language: 'Hindi',
    category: 'Bollywood',
    durationSec: 321,
  },
  {
    id: 'bollywood-agar-tum-saath-ho',
    videoId: 'R6Em5fyilcM',
    title: 'Agar Tum Saath Ho (Karaoke)',
    artist: 'Alka Yagnik, Arijit Singh',
    language: 'Hindi',
    category: 'Bollywood',
    durationSec: 341,
  },

  // Punjabi & Karan Aujla (verified karaoke / instrumental backing tracks)
  {
    id: 'punjabi-tauba-tauba-aujla',
    videoId: 'cdiukwXq6Fw',
    title: 'Tauba Tauba (Karaoke with Lyrics)',
    artist: 'Karan Aujla',
    language: 'Punjabi / Hindi',
    category: 'Punjabi',
    durationSec: 224,
  },
  {
    id: 'punjabi-for-a-reason-aujla',
    videoId: 'R-GlTpvzot0',
    title: 'For A Reason (Karaoke with Lyrics)',
    artist: 'Karan Aujla',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 178,
  },
  {
    id: 'punjabi-at-peace-aujla',
    videoId: 'KeUMo4vOy2Q',
    title: 'At Peace (Karaoke with Lyrics)',
    artist: 'Karan Aujla',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 165,
  },
  {
    id: 'punjabi-softly-aujla',
    videoId: 'aMC1rJx7g5Y',
    title: 'Softly (Karaoke Instrumental)',
    artist: 'Karan Aujla, Ikky',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 153,
  },
  {
    id: 'punjabi-winning-speech-aujla',
    videoId: 'BNnPltt9MOc',
    title: 'Winning Speech (Karaoke)',
    artist: 'Karan Aujla',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 222,
  },
  {
    id: 'punjabi-lover',
    videoId: 'Jbrh-BDljhM',
    title: 'Lover (Karaoke)',
    artist: 'Diljit Dosanjh',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 192,
  },
  {
    id: 'punjabi-excuses',
    videoId: 'PYj62LRbPhE',
    title: 'Excuses (Instrumental Karaoke)',
    artist: 'AP Dhillon, Gurinder Gill',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 176,
  },
  {
    id: 'punjabi-brown-munde',
    videoId: 'pg_St5CUrlQ',
    title: 'Brown Munde (Instrumental Karaoke)',
    artist: 'AP Dhillon',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 267,
  },
  {
    id: 'punjabi-laung-laachi',
    videoId: '_Tap5QgAjVY',
    title: 'Laung Laachi (Karaoke)',
    artist: 'Mannat Noor',
    language: 'Punjabi',
    category: 'Punjabi',
    durationSec: 178,
  },

  // Hindi retro (verified karaoke / instrumental backing tracks)
  {
    id: 'retro-pal-pal-dil-ke-paas',
    videoId: 'YD6MN1SvjAc',
    title: 'Pal Pal Dil Ke Paas (Karaoke)',
    artist: 'Kishore Kumar',
    language: 'Hindi',
    category: 'Hindi retro',
    durationSec: 325,
  },
  {
    id: 'retro-lag-ja-gale',
    videoId: 'z0LcBBsr1ig',
    title: 'Lag Ja Gale (Karaoke)',
    artist: 'Lata Mangeshkar',
    language: 'Hindi',
    category: 'Hindi retro',
    durationSec: 258,
  },
  {
    id: 'retro-mere-sapno-ki-rani',
    videoId: 'g0k9XbI5bn8',
    title: 'Mere Sapnon Ki Rani (Karaoke)',
    artist: 'Kishore Kumar',
    language: 'Hindi',
    category: 'Hindi retro',
    durationSec: 274,
  },
  {
    id: 'retro-gulabi-aankhen',
    videoId: '0clDXacCD9E',
    title: 'Gulabi Aankhen (Karaoke)',
    artist: 'Mohammed Rafi',
    language: 'Hindi',
    category: 'Hindi retro',
    durationSec: 205,
  },

  // 90s Hindi (verified karaoke / instrumental backing tracks)
  {
    id: '90s-tujhe-dekha-toh',
    videoId: 'RGSsCOGOmYI',
    title: 'Tujhe Dekha Toh (Karaoke)',
    artist: 'Kumar Sanu, Lata Mangeshkar',
    language: 'Hindi',
    category: '90s',
    durationSec: 304,
  },
  {
    id: '90s-pehla-nasha',
    videoId: '17bJ89Ht7zs',
    title: 'Pehla Nasha (Karaoke)',
    artist: 'Udit Narayan, Sadhana Sargam',
    language: 'Hindi',
    category: '90s',
    durationSec: 294,
  },

  // regional (verified karaoke / instrumental backing tracks)
  {
    id: 'regional-why-this-kolaveri',
    videoId: '6trccsb-lYw',
    title: 'Why This Kolaveri Di (Karaoke)',
    artist: 'Dhanush, Anirudh',
    language: 'Tamil / Tanglish',
    category: 'regional',
    durationSec: 249,
  },
  {
    id: 'regional-zingaat',
    videoId: 'UExaoFsiJn0',
    title: 'Zingaat (Karaoke)',
    artist: 'Ajay-Atul',
    language: 'Marathi',
    category: 'regional',
    durationSec: 226,
  },
  {
    id: 'regional-jimikki-kammal',
    videoId: 'NWAm1mxAai8',
    title: 'Entammede Jimikki Kammal (Karaoke)',
    artist: 'Vineeth Sreenivasan',
    language: 'Malayalam',
    category: 'regional',
    durationSec: 199,
  },
  {
    id: 'regional-buttabomma',
    videoId: 'rd_TuqB-4yg',
    title: 'ButtaBomma (Karaoke)',
    artist: 'Armaan Malik, Thaman S',
    language: 'Telugu',
    category: 'regional',
    durationSec: 198,
  },

  // devotional (verified karaoke / instrumental backing tracks)
  {
    id: 'devotional-achyutam-keshavam',
    videoId: 'cCQ_b6bekUw',
    title: 'Achyutam Keshavam (Karaoke)',
    artist: 'Vikram Hazra',
    language: 'Sanskrit / Hindi',
    category: 'devotional',
    durationSec: 318,
  },
  {
    id: 'devotional-hanuman-chalisa',
    videoId: 'NQeQNShml0I',
    title: 'Shri Hanuman Chalisa (Karaoke)',
    artist: 'Traditional Bhajan',
    language: 'Awadhi / Hindi',
    category: 'devotional',
    durationSec: 583,
  },
  {
    id: 'devotional-kun-faya-kun',
    videoId: 'R5ntdfnNGK4',
    title: 'Kun Faya Kun (Karaoke)',
    artist: 'A.R. Rahman, Javed Ali',
    language: 'Hindi / Urdu',
    category: 'devotional',
    durationSec: 472,
  },
  {
    id: 'devotional-vaishnav-jana-to',
    videoId: 'tOl2htu2Lqo',
    title: 'Vaishnav Jana To (Instrumental)',
    artist: 'Traditional Bhajan',
    language: 'Gujarati',
    category: 'devotional',
    durationSec: 240,
  },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTrigrams(str: string): Set<string> {
  const padded = `  ${str} `;
  const set = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const triA = buildTrigrams(a);
  const triB = buildTrigrams(b);
  let intersection = 0;
  for (const t of triA) {
    if (triB.has(t)) intersection++;
  }
  const union = triA.size + triB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function subsequenceScore(query: string, target: string): number {
  let qi = 0;
  let consecutive = 0;
  let bonus = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      qi++;
      consecutive++;
      bonus += consecutive;
    } else {
      consecutive = 0;
    }
  }
  if (qi < query.length) return 0;
  return Math.min(1, (query.length + bonus * 0.15) / (target.length + 4));
}

export function scoreSongMatch(song: SongItem, rawQuery: string): number {
  const q = normalizeText(rawQuery);
  if (!q) return 1;

  const title = normalizeText(song.title);
  const artist = normalizeText(song.artist);
  const category = normalizeText(song.category);
  const language = normalizeText(song.language);
  const combined = `${title} ${artist} ${category} ${language}`;

  let score = 0;

  if (title === q) score += 100;
  if (title.startsWith(q)) score += 60;
  if (title.includes(q)) score += 45;
  if (artist.includes(q)) score += 40;
  if (category.includes(q) || language.includes(q)) score += 30;

  const tokens = q.split(' ').filter(Boolean);
  let tokenMatches = 0;
  for (const tok of tokens) {
    if (combined.includes(tok)) {
      tokenMatches++;
    } else {
      const sub = subsequenceScore(tok, combined);
      if (sub > 0.35) tokenMatches += sub;
    }
  }
  if (tokens.length > 0) {
    score += (tokenMatches / tokens.length) * 35;
  }

  const triTitle = trigramSimilarity(q, title);
  const triArtist = trigramSimilarity(q, artist);
  const triCombined = trigramSimilarity(q, combined);
  score += Math.max(triTitle * 45, triArtist * 40, triCombined * 35);

  const subScore = subsequenceScore(q.replace(/\s+/g, ''), combined.replace(/\s+/g, ''));
  score += subScore * 20;

  return score;
}

export function fuzzySearchSongs(
  songs: SongItem[],
  query: string,
  category?: SongCategory | 'All'
): SongItem[] {
  const filtered =
    category && category !== 'All'
      ? songs.filter((s) => s.category === category)
      : songs;

  const trimmed = query.trim();
  if (!trimmed) return filtered;

  return filtered
    .map((song) => ({ song, score: scoreSongMatch(song, trimmed) }))
    .filter((entry) => entry.score >= 12)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.song);
}
