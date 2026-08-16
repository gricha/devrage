export interface DetectionResult {
  /** Total swear words found in the text */
  count: number;
  /** Individual matches */
  matches: Match[];
}

export interface Match {
  word: string;
  index: number;
  severity: Severity;
  group: string;
}

export type Severity = "mild" | "moderate" | "strong";

interface WordDef {
  word: string;
  severity: Severity;
  group: string;
}

/**
 * Core wordlist: canonical forms, conjugations, compound words, and common typos.
 * Grouped by root word for reporting rollup.
 *
 * Sources:
 * - swearjar npm (en_US.json) for compound words
 * - Manual typo variants based on common keyboard transpositions
 */
const WORDLIST: WordDef[] = [
  // === FUCK family (strong) ===
  // Canonical forms
  { word: "fuck", severity: "strong", group: "fuck" },
  { word: "fucking", severity: "strong", group: "fuck" },
  { word: "fucked", severity: "strong", group: "fuck" },
  { word: "fucker", severity: "strong", group: "fuck" },
  { word: "fuckin", severity: "strong", group: "fuck" },
  { word: "fucks", severity: "strong", group: "fuck" },
  // Compound words
  { word: "motherfucker", severity: "strong", group: "fuck" },
  { word: "motherfucking", severity: "strong", group: "fuck" },
  { word: "mothafucka", severity: "strong", group: "fuck" },
  { word: "fuckup", severity: "strong", group: "fuck" },
  { word: "fuckoff", severity: "strong", group: "fuck" },
  { word: "clusterfuck", severity: "strong", group: "fuck" },
  { word: "fuckwit", severity: "strong", group: "fuck" },
  { word: "fucktard", severity: "strong", group: "fuck" },
  { word: "fuckface", severity: "strong", group: "fuck" },
  { word: "fuckhead", severity: "strong", group: "fuck" },
  // Typos — transpositions
  { word: "fukc", severity: "strong", group: "fuck" },
  { word: "fukcing", severity: "strong", group: "fuck" },
  { word: "fukced", severity: "strong", group: "fuck" },
  { word: "fukcer", severity: "strong", group: "fuck" },
  { word: "fcuk", severity: "strong", group: "fuck" },
  { word: "fcuking", severity: "strong", group: "fuck" },
  { word: "fcuked", severity: "strong", group: "fuck" },
  { word: "fuk", severity: "strong", group: "fuck" },
  { word: "fuking", severity: "strong", group: "fuck" },
  { word: "fuked", severity: "strong", group: "fuck" },
  { word: "fuker", severity: "strong", group: "fuck" },
  { word: "fuxk", severity: "strong", group: "fuck" },
  { word: "fuxking", severity: "strong", group: "fuck" },

  // === SHIT family (strong) ===
  { word: "shit", severity: "strong", group: "shit" },
  { word: "shitty", severity: "strong", group: "shit" },
  { word: "shitting", severity: "strong", group: "shit" },
  { word: "shits", severity: "strong", group: "shit" },
  { word: "shitted", severity: "strong", group: "shit" },
  // Compound words
  { word: "bullshit", severity: "strong", group: "shit" },
  { word: "horseshit", severity: "strong", group: "shit" },
  { word: "dipshit", severity: "strong", group: "shit" },
  { word: "shitshow", severity: "strong", group: "shit" },
  { word: "shithead", severity: "strong", group: "shit" },
  { word: "shithole", severity: "strong", group: "shit" },
  { word: "shitface", severity: "strong", group: "shit" },
  { word: "shitfaced", severity: "strong", group: "shit" },
  { word: "shitstain", severity: "strong", group: "shit" },
  { word: "shitbag", severity: "strong", group: "shit" },
  // Typos
  { word: "hsit", severity: "strong", group: "shit" },
  { word: "siht", severity: "strong", group: "shit" },
  { word: "shti", severity: "strong", group: "shit" },
  { word: "sjit", severity: "strong", group: "shit" },
  { word: "shjt", severity: "strong", group: "shit" },
  { word: "bulshit", severity: "strong", group: "shit" },
  { word: "bullsht", severity: "strong", group: "shit" },

  // === ASS family (moderate) ===
  { word: "ass", severity: "moderate", group: "ass" },
  { word: "asses", severity: "moderate", group: "ass" },
  // Compound words (these are strong)
  { word: "asshole", severity: "strong", group: "ass" },
  { word: "assholes", severity: "strong", group: "ass" },
  { word: "jackass", severity: "strong", group: "ass" },
  { word: "dumbass", severity: "strong", group: "ass" },
  { word: "fatass", severity: "moderate", group: "ass" },
  { word: "asshat", severity: "strong", group: "ass" },
  { word: "asswipe", severity: "strong", group: "ass" },
  { word: "badass", severity: "mild", group: "ass" },

  // === DAMN family (moderate) ===
  { word: "damn", severity: "moderate", group: "damn" },
  { word: "damned", severity: "moderate", group: "damn" },
  { word: "damnit", severity: "moderate", group: "damn" },
  { word: "dammit", severity: "moderate", group: "damn" },
  { word: "goddamn", severity: "moderate", group: "damn" },
  { word: "goddamnit", severity: "moderate", group: "damn" },
  { word: "goddammit", severity: "moderate", group: "damn" },

  // === BITCH family (strong) ===
  { word: "bitch", severity: "strong", group: "bitch" },
  { word: "bitches", severity: "strong", group: "bitch" },
  { word: "bitching", severity: "strong", group: "bitch" },
  { word: "bitchy", severity: "strong", group: "bitch" },
  { word: "bitchass", severity: "strong", group: "bitch" },

  // === BASTARD (strong) ===
  { word: "bastard", severity: "strong", group: "bastard" },
  { word: "bastards", severity: "strong", group: "bastard" },

  // === PISS family (moderate) ===
  { word: "piss", severity: "moderate", group: "piss" },
  { word: "pissed", severity: "moderate", group: "piss" },
  { word: "pissing", severity: "moderate", group: "piss" },
  { word: "pissoff", severity: "moderate", group: "piss" },

  // === DICK (moderate) ===
  { word: "dick", severity: "moderate", group: "dick" },
  { word: "dickhead", severity: "strong", group: "dick" },

  // === CRAP (moderate) ===
  { word: "crap", severity: "moderate", group: "crap" },
  { word: "crappy", severity: "moderate", group: "crap" },
  { word: "crapping", severity: "moderate", group: "crap" },

  // === HELL (mild) ===
  { word: "hell", severity: "mild", group: "hell" },

  // === Abbreviations (mild) ===
  { word: "wtf", severity: "mild", group: "wtf" },
  { word: "stfu", severity: "mild", group: "stfu" },
  { word: "lmfao", severity: "mild", group: "lmfao" },
  { word: "lmao", severity: "mild", group: "lmao" },

  // === CUNT (strong) ===
  { word: "cunt", severity: "strong", group: "cunt" },
  { word: "cunts", severity: "strong", group: "cunt" },

  // ============================================================
  // SPANISH (es) — covers general Spanish + Chilean (es-CL) slang
  // ============================================================
  // Notes:
  // - Both accented and non-accented forms are listed (people type
  //   "weon" and "weón" both — phones autocorrect, devs skip accents).
  // - Severity reflects how the word is *used as a swear*, not its
  //   dictionary meaning. e.g. "weón" in Chile is often a filler/buddy
  //   word but it's still classified as profanity → moderate.
  // - Group names are kept ASCII for stable rollup output.

  // === MIERDA family (strong) — "shit" ===
  { word: "mierda", severity: "strong", group: "mierda" },
  { word: "mierdas", severity: "strong", group: "mierda" },
  { word: "mierdero", severity: "strong", group: "mierda" },
  { word: "amierdado", severity: "strong", group: "mierda" },
  // Typos
  { word: "miedra", severity: "strong", group: "mierda" },
  { word: "mierdaa", severity: "strong", group: "mierda" },

  // === PUTA / PUTO family (strong) — "whore / fucking" ===
  { word: "puta", severity: "strong", group: "puta" },
  { word: "putas", severity: "strong", group: "puta" },
  { word: "puto", severity: "strong", group: "puta" },
  { word: "putos", severity: "strong", group: "puta" },
  { word: "putear", severity: "strong", group: "puta" },
  { word: "puteado", severity: "strong", group: "puta" },
  { word: "putada", severity: "strong", group: "puta" },
  { word: "putamadre", severity: "strong", group: "puta" },
  { word: "putamadres", severity: "strong", group: "puta" },
  // Common abbreviations
  { word: "hdp", severity: "strong", group: "puta" }, // hijo de puta
  { word: "hdpta", severity: "strong", group: "puta" },
  { word: "lpm", severity: "strong", group: "puta" }, // la puta madre
  { word: "ptm", severity: "strong", group: "puta" }, // puta madre

  // === JODER family (strong) — "fuck" (Spain/general) ===
  { word: "joder", severity: "strong", group: "joder" },
  { word: "jode", severity: "strong", group: "joder" },
  { word: "jodes", severity: "strong", group: "joder" },
  { word: "jodido", severity: "strong", group: "joder" },
  { word: "jodida", severity: "strong", group: "joder" },
  { word: "jodidos", severity: "strong", group: "joder" },
  { word: "jodidas", severity: "strong", group: "joder" },
  { word: "jodiendo", severity: "strong", group: "joder" },
  { word: "jodete", severity: "strong", group: "joder" },
  { word: "jodanse", severity: "strong", group: "joder" },

  // === COÑO family (strong) — "fuck" (Spain) ===
  // Note: only the accented form is listed. The de-accented "cono"
  // false-matches inside "ícono" / "íconos" because `í` is a non-word
  // char in JS regex, creating an artificial \b boundary.
  { word: "coño", severity: "strong", group: "cono" },
  { word: "coñazo", severity: "strong", group: "cono" },

  // === CABRÓN family (strong) — "bastard" ===
  { word: "cabrón", severity: "strong", group: "cabron" },
  { word: "cabron", severity: "strong", group: "cabron" },
  { word: "cabrones", severity: "strong", group: "cabron" },
  { word: "cabrona", severity: "strong", group: "cabron" },
  { word: "cabronas", severity: "strong", group: "cabron" },
  { word: "cabreado", severity: "moderate", group: "cabron" },
  { word: "cabreada", severity: "moderate", group: "cabron" },

  // === PENDEJO family (strong) — "asshole" (LatAm) ===
  { word: "pendejo", severity: "strong", group: "pendejo" },
  { word: "pendeja", severity: "strong", group: "pendejo" },
  { word: "pendejos", severity: "strong", group: "pendejo" },
  { word: "pendejas", severity: "strong", group: "pendejo" },
  { word: "pendejada", severity: "strong", group: "pendejo" },
  { word: "pendejadas", severity: "strong", group: "pendejo" },

  // === CHINGAR family (strong) — "fuck" (Mexico, also used elsewhere) ===
  { word: "chingar", severity: "strong", group: "chingar" },
  { word: "chinga", severity: "strong", group: "chingar" },
  { word: "chingada", severity: "strong", group: "chingar" },
  { word: "chingado", severity: "strong", group: "chingar" },
  { word: "chingados", severity: "strong", group: "chingar" },
  { word: "chingadera", severity: "strong", group: "chingar" },
  { word: "chingón", severity: "moderate", group: "chingar" },
  { word: "chingona", severity: "moderate", group: "chingar" },

  // === GILIPOLLAS family (strong) — "moron" (Spain) ===
  { word: "gilipollas", severity: "strong", group: "gilipollas" },
  { word: "gilipollez", severity: "strong", group: "gilipollas" },
  { word: "gilipolleces", severity: "strong", group: "gilipollas" },

  // === MARICÓN family (strong) — slur, used as insult ===
  { word: "maricón", severity: "strong", group: "maricon" },
  { word: "maricon", severity: "strong", group: "maricon" },
  { word: "maricones", severity: "strong", group: "maricon" },
  { word: "marica", severity: "strong", group: "maricon" },
  { word: "maracos", severity: "strong", group: "maricon" }, // Chilean variant
  { word: "maraco", severity: "strong", group: "maricon" },

  // === VERGA family (strong) — "dick" (LatAm) ===
  { word: "verga", severity: "strong", group: "verga" },
  { word: "vergas", severity: "strong", group: "verga" },
  { word: "vergazo", severity: "strong", group: "verga" },
  { word: "vergueando", severity: "strong", group: "verga" },

  // === POLLA family (strong) — "dick" (Spain) ===
  { word: "polla", severity: "strong", group: "polla" },
  { word: "pollas", severity: "strong", group: "polla" },

  // === BOLUDO family (strong) — "asshole" (Argentina, also Chile) ===
  { word: "boludo", severity: "strong", group: "boludo" },
  { word: "boluda", severity: "strong", group: "boludo" },
  { word: "boludos", severity: "strong", group: "boludo" },
  { word: "boludas", severity: "strong", group: "boludo" },
  { word: "boludez", severity: "moderate", group: "boludo" },
  { word: "pelotudo", severity: "strong", group: "boludo" },
  { word: "pelotuda", severity: "strong", group: "boludo" },
  { word: "pelotudos", severity: "strong", group: "boludo" },

  // ============================================================
  // CHILEAN (es-CL) specifics — heavy on chilenismos
  // ============================================================

  // === WEÓN / HUEÓN family (moderate) — Chilean staple ===
  // Used as filler, friendly, *and* insult — counted as profanity regardless.
  { word: "weón", severity: "moderate", group: "weon" },
  { word: "weon", severity: "moderate", group: "weon" },
  { word: "weones", severity: "moderate", group: "weon" },
  { word: "weona", severity: "moderate", group: "weon" },
  { word: "weonas", severity: "moderate", group: "weon" },
  { word: "weoncito", severity: "moderate", group: "weon" },
  { word: "weoncita", severity: "moderate", group: "weon" },
  { word: "hueón", severity: "moderate", group: "weon" },
  { word: "hueon", severity: "moderate", group: "weon" },
  { word: "hueones", severity: "moderate", group: "weon" },
  { word: "huevón", severity: "moderate", group: "weon" },
  { word: "huevon", severity: "moderate", group: "weon" },
  { word: "huevones", severity: "moderate", group: "weon" },
  { word: "huevona", severity: "moderate", group: "weon" },
  { word: "wn", severity: "moderate", group: "weon" }, // chat abbreviation

  // === AWEONAO / AHUEONADO family (strong) — Chilean "dumbass" ===
  { word: "aweonao", severity: "strong", group: "aweonao" },
  { word: "aweoná", severity: "strong", group: "aweonao" },
  { word: "aweonados", severity: "strong", group: "aweonao" },
  { word: "aweonadas", severity: "strong", group: "aweonao" },
  { word: "ahueonao", severity: "strong", group: "aweonao" },
  { word: "ahueonado", severity: "strong", group: "aweonao" },
  { word: "ahueonada", severity: "strong", group: "aweonao" },
  { word: "ahuevonado", severity: "strong", group: "aweonao" },
  { word: "ahuevonada", severity: "strong", group: "aweonao" },
  { word: "aweonaos", severity: "strong", group: "aweonao" },

  // === WEA / HUEÁ family (moderate) — Chilean "thing/shit" ===
  { word: "wea", severity: "moderate", group: "wea" },
  { word: "weá", severity: "moderate", group: "wea" },
  { word: "weas", severity: "moderate", group: "wea" },
  { word: "weás", severity: "moderate", group: "wea" },
  { word: "huea", severity: "moderate", group: "wea" },
  { word: "hueá", severity: "moderate", group: "wea" },
  { word: "hueas", severity: "moderate", group: "wea" },
  { word: "hueás", severity: "moderate", group: "wea" },
  { word: "huevada", severity: "moderate", group: "wea" },
  { word: "huevadas", severity: "moderate", group: "wea" },
  { word: "huevear", severity: "moderate", group: "wea" },
  { word: "hueveando", severity: "moderate", group: "wea" },
  { word: "webear", severity: "moderate", group: "wea" },
  { word: "webeando", severity: "moderate", group: "wea" },

  // === CULIAO / CULIADO family (strong) — Chilean "asshole/fucker" ===
  { word: "culiao", severity: "strong", group: "culiao" },
  { word: "culiá", severity: "strong", group: "culiao" },
  { word: "culiados", severity: "strong", group: "culiao" },
  { word: "culiadas", severity: "strong", group: "culiao" },
  { word: "culiada", severity: "strong", group: "culiao" },
  { word: "culiado", severity: "strong", group: "culiao" },
  { word: "culiaos", severity: "strong", group: "culiao" },
  { word: "culear", severity: "strong", group: "culiao" },
  { word: "culiar", severity: "strong", group: "culiao" },
  { word: "culiando", severity: "strong", group: "culiao" },

  // === CONCHETUMARE family (strong) — Chilean "motherfucker" ===
  // "concha [de] tu madre" — most iconic Chilean insult.
  { word: "conchetumare", severity: "strong", group: "conchetumare" },
  { word: "conchesumare", severity: "strong", group: "conchetumare" },
  { word: "conchatumadre", severity: "strong", group: "conchetumare" },
  { word: "conchadetumadre", severity: "strong", group: "conchetumare" },
  { word: "conchesumadre", severity: "strong", group: "conchetumare" },
  { word: "chuchadetumadre", severity: "strong", group: "conchetumare" },
  { word: "chuchasumadre", severity: "strong", group: "conchetumare" },
  // Abbreviations widely used in chats / commits
  { word: "ctm", severity: "strong", group: "conchetumare" },
  { word: "csm", severity: "strong", group: "conchetumare" },
  { word: "qlctm", severity: "strong", group: "conchetumare" },

  // === CHUCHA family (moderate) — Chilean "fuck!" / "damn!" ===
  { word: "chucha", severity: "moderate", group: "chucha" },
  { word: "chuchas", severity: "moderate", group: "chucha" },
  { word: "chuchetas", severity: "moderate", group: "chucha" },

  // === SACOWEA family (strong) — Chilean "fuckup/idiot" ===
  { word: "sacowea", severity: "strong", group: "sacowea" },
  { word: "sacoweas", severity: "strong", group: "sacowea" },
  { word: "sacowetas", severity: "strong", group: "sacowea" },
  { word: "sacohuea", severity: "strong", group: "sacowea" },
  { word: "sacohueas", severity: "strong", group: "sacowea" },
  { word: "sacodehueas", severity: "strong", group: "sacowea" },
  { word: "sakowea", severity: "strong", group: "sacowea" }, // common typo

  // === CRESTA (moderate) — Chilean "fuck!" / "to hell" ===
  { word: "cresta", severity: "moderate", group: "cresta" },
  { word: "crestazo", severity: "moderate", group: "cresta" },

  // === GIL family — INTENTIONALLY OMITTED ===
  // "gil" is real Chilean slang ("idiot") but it's only 3 chars and
  // false-matches inside "ágil" / "frágil" / "frágiles" because the
  // accented vowel acts as a non-word char in JS regex. In tech corpora
  // (agile methodology, etc.) the noise dominates true usage. Skipped.

  // === CAGAR family (strong) — "to shit / fuck up" ===
  // (Chilean "la cagaste" is everyday but still profanity-tier)
  { word: "cagar", severity: "strong", group: "cagada" },
  { word: "cagada", severity: "strong", group: "cagada" },
  { word: "cagadas", severity: "strong", group: "cagada" },
  { word: "cagado", severity: "strong", group: "cagada" },
  { word: "cagados", severity: "strong", group: "cagada" },
  { word: "cagando", severity: "strong", group: "cagada" },
  { word: "cagaste", severity: "strong", group: "cagada" },
  { word: "cagamos", severity: "strong", group: "cagada" },
  { word: "cagón", severity: "moderate", group: "cagada" },
  { word: "cagona", severity: "moderate", group: "cagada" },

  // === Chilean / Spanish moderate insults ===
  { word: "imbécil", severity: "strong", group: "imbecil" },
  { word: "imbecil", severity: "strong", group: "imbecil" },
  { word: "imbéciles", severity: "strong", group: "imbecil" },
  { word: "imbeciles", severity: "strong", group: "imbecil" },
  { word: "idiota", severity: "moderate", group: "idiota" },
  { word: "idiotas", severity: "moderate", group: "idiota" },
  { word: "estúpido", severity: "moderate", group: "estupido" },
  { word: "estupido", severity: "moderate", group: "estupido" },
  { word: "estúpida", severity: "moderate", group: "estupido" },
  { word: "estupida", severity: "moderate", group: "estupido" },
  { word: "estúpidos", severity: "moderate", group: "estupido" },
  { word: "estupidos", severity: "moderate", group: "estupido" },
  { word: "tarado", severity: "moderate", group: "tarado" },
  { word: "tarada", severity: "moderate", group: "tarado" },
  { word: "tarados", severity: "moderate", group: "tarado" },

  // === Mild Spanish ===
  { word: "tonto", severity: "mild", group: "tonto" },
  { word: "tonta", severity: "mild", group: "tonto" },
  { word: "tontos", severity: "mild", group: "tonto" },
  { word: "tontas", severity: "mild", group: "tonto" },
  { word: "leso", severity: "mild", group: "leso" }, // Chilean "dumb"
  { word: "lesa", severity: "mild", group: "leso" },
];

/**
 * Normalize text before matching:
 * 1. Collapse repeated characters (3+ of the same char → 2)
 *    e.g. "fuuuuck" → "fuuck", "shiiiiit" → "shiit"
 *    This lets "fuuuuck" match against "fuck" after the regex runs,
 *    because the pattern also includes "fuuck" style intermediates.
 *
 * Actually — better approach: collapse ALL runs of 2+ to 1 for matching
 * purposes, while keeping the original text for position tracking.
 * e.g. "fuuuuck" → "fuck", "shiiiit" → "shit"
 * This directly normalizes to the root word.
 */
function collapseRepeats(text: string): string {
  return text.replace(/(.)\1+/g, "$1");
}

/**
 * Build the detection regex from the wordlist.
 * Sort longer words first so "motherfucker" matches before "fuck".
 */
function buildPattern(words: WordDef[]): RegExp {
  const sorted = [...words].sort((a, b) => b.word.length - a.word.length);
  const pattern = sorted.map((w) => w.word).join("|");
  return new RegExp(`\\b(${pattern})\\b`, "gi");
}

const DEFAULT_PATTERN = buildPattern(WORDLIST);
const WORD_MAP = new Map(WORDLIST.map((w) => [w.word.toLowerCase(), w]));

/**
 * Detect profanity in a string.
 *
 * Runs detection in two passes:
 * 1. Direct match on original text (preserves positions)
 * 2. Match on repeat-collapsed text (catches fuuuuck, shiiiiit, etc.)
 */
export function detect(text: string): DetectionResult {
  const matches: Match[] = [];
  const seen = new Set<number>(); // track original-text positions we've already matched

  // Pass 1: direct match on original (lowercase) text
  runPattern(text, text.toLowerCase(), matches, seen);

  // Pass 2: match on collapsed text to catch repeated chars
  const collapsed = collapseRepeats(text.toLowerCase());
  if (collapsed !== text.toLowerCase()) {
    runPattern(text, collapsed, matches, seen);
  }

  return { count: matches.length, matches };
}

function runPattern(
  _originalText: string,
  searchText: string,
  matches: Match[],
  seen: Set<number>,
): void {
  DEFAULT_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = DEFAULT_PATTERN.exec(searchText)) !== null) {
    if (seen.has(match.index)) {
      continue;
    }

    const word = match[0].toLowerCase();
    const entry = WORD_MAP.get(word);
    if (!entry) {
      continue;
    }

    seen.add(match.index);
    matches.push({
      word,
      index: match.index,
      severity: entry.severity,
      group: entry.group,
    });
  }
}

/**
 * Create a custom detector with additional words.
 */
export function createDetector(extraWords?: WordDef[]): (text: string) => DetectionResult {
  const allWords = extraWords ? [...WORDLIST, ...extraWords] : WORDLIST;
  const pattern = buildPattern(allWords);
  const wordMap = new Map(allWords.map((w) => [w.word.toLowerCase(), w]));

  return (text: string): DetectionResult => {
    const matches: Match[] = [];
    const seen = new Set<number>();

    const lower = text.toLowerCase();
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lower)) !== null) {
      if (seen.has(match.index)) {
        continue;
      }
      const word = match[0].toLowerCase();
      const entry = wordMap.get(word);
      if (!entry) {
        continue;
      }
      seen.add(match.index);
      matches.push({ word, index: match.index, severity: entry.severity, group: entry.group });
    }

    const collapsed = collapseRepeats(lower);
    if (collapsed !== lower) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(collapsed)) !== null) {
        if (seen.has(match.index)) {
          continue;
        }
        const word = match[0].toLowerCase();
        const entry = wordMap.get(word);
        if (!entry) {
          continue;
        }
        seen.add(match.index);
        matches.push({ word, index: match.index, severity: entry.severity, group: entry.group });
      }
    }

    return { count: matches.length, matches };
  };
}

export type { WordDef as WordEntry };
