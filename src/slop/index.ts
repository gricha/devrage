export interface SlopDetectionResult {
  /** Total non-overlapping AI-writing tells found in the prose. */
  count: number;
  /** Individual tells in source order. */
  matches: SlopMatch[];
}

export interface SlopMatch {
  /** Canonical name used for reporting. */
  tell: string;
  /** Text that triggered the tell. */
  text: string;
  /** UTF-16 offset in the original message. */
  index: number;
  category: SlopCategory;
}

export type SlopCategory =
  | "claude-ism"
  | "sycophancy"
  | "stock prose"
  | "rhetorical template"
  | "formatting";

interface SlopSignal {
  tell: string;
  category: Exclude<SlopCategory, "formatting">;
  pattern: RegExp;
}

interface Candidate extends SlopMatch {
  end: number;
}

/**
 * This list favors phrases developers specifically call out in coding-agent
 * output over generic lists of formal words. Primary research:
 *
 * - https://x.com/jerols/status/2085488576251219973
 * - https://x.com/Voxyz_ai/status/2078857039116156978
 * - https://x.com/kylefox/status/2075280984430514557
 * - https://x.com/ICooper/status/2081740252864008343
 * - https://x.com/rubenhassid/status/2080608944981237799
 * - https://github.com/anthropics/claude-code/issues/53454
 * - https://github.com/anthropics/claude-code/issues/50087
 * - https://jola.dev/posts/how-to-stop-claude-from-saying-load-bearing
 *
 * Ordinary engineering words such as "robust", "harness", "seam", and
 * "leverage" are intentionally not signals on their own.
 */
const SLOP_SIGNALS: SlopSignal[] = [
  // Claude's especially recognizable coding-agent voice.
  {
    tell: "load-bearing",
    category: "claude-ism",
    pattern: /\bload(?:[-‐‑‒–—\s]+)bearing\b/giu,
  },
  {
    tell: "honest take",
    category: "claude-ism",
    pattern: /\bhonest\s+(?:take|evaluation|assessment)\b/giu,
  },
  {
    tell: "precise mechanism",
    category: "claude-ism",
    pattern: /\b(?:the\s+)?precise\s+mechanism\b/giu,
  },
  {
    tell: "and that matters",
    category: "claude-ism",
    pattern: /\band\s+that\s+matters\b/giu,
  },
  {
    tell: "key insight",
    category: "claude-ism",
    pattern: /\b(?:the\s+)?key\s+insight\b/giu,
  },
  {
    tell: "without ceremony",
    category: "claude-ism",
    pattern:
      /\b(?:without|with\s+no|needs?\s+no|requires?\s+no|no)\s+(?:additional\s+)?ceremony\b/giu,
  },
  {
    tell: "earns its keep",
    category: "claude-ism",
    pattern: /\bearn(?:s|ed|ing)?\s+(?:its|their|the)\s+keep\b/giu,
  },
  {
    tell: "keeps X honest",
    category: "claude-ism",
    pattern:
      /\b(?:keep|keeps|keeping|kept)\s+(?:(?:this|that|us|me|things?)|(?:the|our|your|my)\s+[\w-]+(?:\s+[\w-]+){0,2})\s+honest\b/giu,
  },
  {
    tell: "belt-and-suspenders",
    category: "claude-ism",
    pattern: /\bbelt(?:[-‐‑‒–—\s]+)and(?:[-‐‑‒–—\s]+)suspenders\b/giu,
  },
  {
    tell: "soup to nuts",
    category: "claude-ism",
    pattern: /\b(?:from\s+)?soup(?:[-‐‑‒–—\s]+)to(?:[-‐‑‒–—\s]+)nuts\b/giu,
  },
  {
    tell: "architectural seam",
    category: "claude-ism",
    pattern:
      /\b(?:(?:clean|natural|architectural|implementation|integration)\s+seam|(?:at|across)\s+the\s+seam\s+between)\b/giu,
  },

  // The apology/validation loop developers see after correcting an agent.
  {
    tell: "you're absolutely right",
    category: "sycophancy",
    pattern: /\byou(?:['’]re|\s+are)\s+absolutely\s+right\b/giu,
  },
  {
    tell: "you're right to call that out",
    category: "sycophancy",
    pattern:
      /\byou(?:['’]re|\s+are)\s+right\s+to\s+(?:call|point|flag)\s+(?:me|that|this)\s+out\b/giu,
  },
  {
    tell: "real gap",
    category: "sycophancy",
    pattern: /\b(?:a\s+)?real\s+gap\b/giu,
  },
  {
    tell: "error in my framing",
    category: "sycophancy",
    pattern: /\b(?:a\s+)?real\s+error\s+in\s+(?:my|the)\s+framing\b/giu,
  },
  {
    tell: "I was wrong",
    category: "sycophancy",
    pattern: /\bi\s+was\s+wrong\b/giu,
  },
  {
    tell: "I overcomplicated it",
    category: "sycophancy",
    pattern: /\bi\s+(?:overcomplicated|over-engineered|overthought)\s+(?:this|that|it)\b/giu,
  },

  // Cross-model corporate/chatbot prose, constrained where a raw word is technical.
  { tell: "delve", category: "stock prose", pattern: /\b(?:delve(?:d|s)?|delving)\b/giu },
  { tell: "crucial", category: "stock prose", pattern: /\bcrucial\b/giu },
  { tell: "pivotal", category: "stock prose", pattern: /\bpivotal\b/giu },
  { tell: "tapestry", category: "stock prose", pattern: /\btapestr(?:y|ies)\b/giu },
  {
    tell: "here's the thing",
    category: "stock prose",
    pattern: /\bhere(?:['’]s|\s+is)\s+the\s+thing\b/giu,
  },
  {
    tell: "hope this helps",
    category: "stock prose",
    pattern: /\bhope\s+(?:this|that)\s+helps\b/giu,
  },
  {
    tell: "after careful consideration",
    category: "stock prose",
    pattern: /\bafter\s+careful\s+consideration\b/giu,
  },
  {
    tell: "quick update",
    category: "stock prose",
    pattern: /\bto\s+provide\s+(?:you\s+with\s+)?a\s+quick\s+update\b/giu,
  },
  {
    tell: "robust and reliable",
    category: "stock prose",
    pattern: /\brobust(?:\s+and|,)\s+reliable\b/giu,
  },
  { tell: "seamless", category: "stock prose", pattern: /\bseamless(?:ly)?\b/giu },
  {
    tell: "in the realm of",
    category: "stock prose",
    pattern: /\b(?:in|within)\s+the\s+realm\s+of\b/giu,
  },
  {
    tell: "important to note",
    category: "stock prose",
    pattern: /\b(?:(?:it\s+is|it(?:['’]s))\s+)?important\s+to\s+note\b/giu,
  },
  {
    tell: "let me break this down",
    category: "stock prose",
    pattern: /\blet\s+(?:me|us)\s+break\s+(?:this|it)\s+down\b/giu,
  },
  {
    tell: "let's dive in",
    category: "stock prose",
    pattern: /\blet(?:['’]s|\s+us)\s+dive\s+(?:in|into)\b/giu,
  },
  {
    tell: "let's unpack this",
    category: "stock prose",
    pattern: /\blet(?:['’]s|\s+us)\s+unpack\s+(?:this|that|it)\b/giu,
  },
  { tell: "at its core", category: "stock prose", pattern: /\bat\s+its\s+core\b/giu },
  {
    tell: "successfully implemented",
    category: "stock prose",
    pattern: /\bsuccessfully\s+(?:added|completed|created|fixed|implemented|resolved|updated)\b/giu,
  },
  {
    tell: "Certainly.",
    category: "stock prose",
    pattern: /(?:^|\n)[\t ]*certainly\b/gimu,
  },
  {
    tell: "I'd be happy to",
    category: "stock prose",
    pattern: /\bi(?:['’]d|\s+would)\s+be\s+happy\s+to\b/giu,
  },

  // Corrective juxtaposition and fake-deep contrast templates.
  {
    tell: "it's not X, it's Y",
    category: "rhetorical template",
    pattern:
      /\b(?:it|this|that)(?:['’]s|\s+is)\s+not\s+[^.!?\n]{1,100}?(?:,|;|—)\s*(?:it|this|that)(?:['’]s|\s+is)\s+[^.!?\n]{1,100}/giu,
  },
  {
    tell: "it's not X, it's Y",
    category: "rhetorical template",
    pattern:
      /\b(?:it|this|that)\s+isn(?:['’]t)\s+[^.!?\n]{1,100}[.!;—]\s*(?:it|this|that)(?:['’]s|\s+is)\s+[^.!?\n]{1,100}/giu,
  },
  {
    tell: "not just X, but Y",
    category: "rhetorical template",
    pattern:
      /\bnot\s+just\s+[^.!?\n]{1,100}?,?\s+(?:but(?:\s+also)?|(?:it|this|that)(?:['’]s|\s+is))\s+[^.!?\n]{1,100}/giu,
  },
];

/** Detect common coding-agent AI-isms in prose while ignoring Markdown code. */
export function detectSlop(text: string): SlopDetectionResult {
  const prose = maskMarkdownCode(text);
  const candidates = SLOP_SIGNALS.flatMap((signal) => findSignalMatches(prose, signal));

  addCheckmarkWall(prose, candidates);

  const matches = longestNonOverlapping(candidates).map(({ end: _end, ...match }) => match);
  return { count: matches.length, matches };
}

function findSignalMatches(text: string, signal: SlopSignal): Candidate[] {
  const matches: Candidate[] = [];
  signal.pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = signal.pattern.exec(text)) !== null) {
    const bounds = trimmedBounds(match[0]);
    if (bounds.text) {
      const index = match.index + bounds.start;
      matches.push({
        tell: signal.tell,
        text: bounds.text,
        index,
        end: index + bounds.text.length,
        category: signal.category,
      });
    }

    if (match[0].length === 0) {
      signal.pattern.lastIndex++;
    }
  }

  return matches;
}

function trimmedBounds(value: string): { text: string; start: number } {
  const start = value.search(/\S/u);
  if (start === -1) {
    return { text: "", start: 0 };
  }

  return { text: value.trim(), start };
}

function maskMarkdownCode(text: string): string {
  return text
    .replace(/(?:```|~~~)[\s\S]*?(?:(?:```|~~~)|$)/gu, preserveNewlines)
    .replace(/`[^`\n]+`/gu, preserveNewlines);
}

function preserveNewlines(value: string): string {
  return value.replace(/[^\n]/gu, " ");
}

function addCheckmarkWall(text: string, candidates: Candidate[]): void {
  const checkmarks = Array.from(text.matchAll(/^[\t ]*(?:[-*]\s*)?[✅✓]\s+/gmu));
  if (checkmarks.length < 3) {
    return;
  }

  const first = checkmarks[0];
  if (!first) {
    return;
  }

  const offset = first[0].search(/[✅✓]/u);
  const index = first.index + Math.max(offset, 0);
  candidates.push({
    tell: "checkmark wall",
    text: `✅ ×${checkmarks.length}`,
    index,
    end: index + 2,
    category: "formatting",
  });
}

function longestNonOverlapping(candidates: Candidate[]): Candidate[] {
  const longestFirst = [...candidates].sort(
    (left, right) =>
      right.end - right.index - (left.end - left.index) ||
      left.index - right.index ||
      left.tell.localeCompare(right.tell),
  );
  const accepted: Candidate[] = [];

  for (const candidate of longestFirst) {
    const overlaps = accepted.some(
      (match) => candidate.index < match.end && candidate.end > match.index,
    );
    if (!overlaps) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((left, right) => left.index - right.index);
}
