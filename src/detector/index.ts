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
  { word: "fucksake", severity: "strong", group: "fuck" },
  // Typos — transpositions
  { word: "fuckssake", severity: "strong", group: "fuck" },
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

  // === Abbreviations (strong) ===
  { word: "mf", severity: "strong", group: "fuck" },
  { word: "fu", severity: "strong", group: "fuck" },

  // === Abbreviations (mild) ===
  { word: "ffs", severity: "mild", group: "fuck" },
  { word: "wtf", severity: "mild", group: "wtf" },
  { word: "wtaf", severity: "mild", group: "wtf" },
  { word: "tf", severity: "mild", group: "wtf" },
  { word: "stfu", severity: "mild", group: "stfu" },
  { word: "lmfao", severity: "mild", group: "lmfao" },
  { word: "lmao", severity: "mild", group: "lmao" },

  // === CUNT (strong) ===
  { word: "cunt", severity: "strong", group: "cunt" },
  { word: "cunts", severity: "strong", group: "cunt" },

  // === RETARD (strong) ===
  { word: "retard", severity: "strong", group: "retard" },
  { word: "retarded", severity: "strong", group: "retard" },

  // === STUPID (moderate) ===
  { word: "stupid", severity: "moderate", group: "stupid" },
  { word: "idiot", severity: "moderate", group: "stupid" },
  { word: "dumb", severity: "moderate", group: "stupid" },
  { word: "dummy", severity: "moderate", group: "stupid" },
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
