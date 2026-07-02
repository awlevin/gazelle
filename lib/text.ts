// Text preparation: tokenize passages, mark the semantically meaningful words
// as fixation targets (skilled readers skip most function words — articles,
// prepositions, pronouns — and let the parafovea fill them in), and cap how
// many words in a row can be skipped so the eye never has to leap too far.

export type Word = {
  text: string;
  /** index within the flat word list */
  index: number;
  /** paragraph the word belongs to */
  paragraph: number;
};

export type QuizQuestion = {
  question: string;
  options: string[];
  answer: number; // index into options
};

export type Passage = {
  id: string;
  title: string;
  difficulty: "Warm-up" | "Standard" | "Dense";
  paragraphs: string[];
  quiz: QuizQuestion[];
};

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet",
  "of", "in", "on", "at", "to", "for", "by", "with", "from", "as", "into",
  "onto", "over", "under", "up", "down", "out", "off", "about", "than",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "has", "have", "had", "will", "would", "shall",
  "should", "can", "could", "may", "might", "must",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
  "them", "my", "your", "his", "its", "our", "their", "this", "that",
  "these", "those", "there", "here", "who", "whom", "which", "what",
  "not", "no", "if", "then", "else", "when", "while", "because", "though",
  "also", "just", "only", "very", "too", "such", "own", "same", "each",
  "any", "all", "some", "few", "more", "most", "other", "both",
]);

export function tokenize(paragraphs: string[]): Word[] {
  const words: Word[] = [];
  paragraphs.forEach((para, p) => {
    for (const raw of para.split(/\s+/)) {
      if (!raw) continue;
      words.push({ text: raw, index: words.length, paragraph: p });
    }
  });
  return words;
}

function isContentWord(text: string): boolean {
  const bare = text.replace(/[^\p{L}\p{N}'’-]/gu, "").toLowerCase();
  if (!bare) return false;
  if (/\d/.test(bare)) return true;
  if (STOPWORDS.has(bare)) return false;
  return bare.length >= 3;
}

/**
 * Pick fixation targets: content words, with the constraint that at most
 * `maxSkip` words in a row are skipped (promoting the longest word in an
 * over-long run). First and last words are always targets so the pass has a
 * clear start and end.
 */
export function selectTargets(words: Word[], maxSkip: number): number[] {
  const isTarget = words.map((w) => isContentWord(w.text));
  if (words.length > 0) {
    isTarget[0] = true;
    isTarget[words.length - 1] = true;
  }

  let runStart = -1;
  for (let i = 0; i <= words.length; i++) {
    const target = i < words.length ? isTarget[i] : true;
    if (!target) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      let s = runStart;
      // Split any skip-run longer than maxSkip by promoting its longest word
      while (i - s > maxSkip) {
        let best = s;
        for (let j = s; j < Math.min(s + maxSkip + 1, i); j++) {
          if (words[j].text.length > words[best].text.length) best = j;
        }
        isTarget[best] = true;
        s = best + 1;
      }
      runStart = -1;
    }
  }

  return words.map((w) => w.index).filter((i) => isTarget[i]);
}

export const PASSAGES: Passage[] = [
  {
    id: "leap",
    title: "The leap",
    difficulty: "Warm-up",
    paragraphs: [
      "A gazelle at full speed does not touch the ground very often. It covers the savanna in a chain of leaps, each one committed before the last has finished, trusting the terrain to be roughly where it expects. Slowing down to inspect every tuft of grass would mean being eaten.",
      "Skilled readers move the same way. Their eyes do not slide along a line of text; they leap, three or four words at a time, landing only on the words that carry meaning. The small connective tissue of language — articles, prepositions, pronouns — is rarely looked at directly. The brain fills it in from the edges of vision, the way the gazelle's legs fill in the ground.",
      "Training this is mostly a matter of trust. Beginners fixate on every word because skipping feels like cheating, and they circle back constantly to check what they already understood. The habit to build is forward commitment: land on the meaningful word, take it, and leap again.",
    ],
    quiz: [
      {
        question: "What does the passage say skilled readers skip?",
        options: [
          "Long technical terms",
          "Connective words like articles and prepositions",
          "The first word of each sentence",
          "Entire paragraphs",
        ],
        answer: 1,
      },
      {
        question: "How does the brain handle the skipped words?",
        options: [
          "It ignores them completely",
          "It reads them on a second pass",
          "It fills them in from the edges of vision",
          "It guesses them from memory of the book",
        ],
        answer: 2,
      },
      {
        question: "What habit does the passage say beginners should build?",
        options: [
          "Forward commitment",
          "Careful re-checking",
          "Reading aloud",
          "Slowing down on hard words",
        ],
        answer: 0,
      },
    ],
  },
  {
    id: "eyes",
    title: "How your eyes actually read",
    difficulty: "Standard",
    paragraphs: [
      "Your eyes are not a camera panning across the page. They move in sudden jumps called saccades, each lasting around thirty milliseconds, and between jumps they hold still in fixations of roughly a quarter of a second. All reading happens during the fixations; during a saccade you are effectively blind, and your brain quietly edits out the blur.",
      "Only a small patch at the center of your vision — the fovea, about the width of two words — is sharp enough to recognize letters. But the blurry region around it, the parafovea, still catches word shapes and lengths. This preview is what lets a practiced reader aim the next saccade at a useful landing site instead of plodding word by word.",
      "The expensive habit is the regression: the backward jump to re-read something you already understood. Studies of eye movements suggest that untrained readers spend up to a third of their reading time on regressions, most of which add nothing. Cutting them is the single fastest way to raise reading speed without losing comprehension, because the time was being wasted, not used.",
    ],
    quiz: [
      {
        question: "When does actual reading happen?",
        options: [
          "During saccades",
          "During fixations",
          "During blinks",
          "Continuously, as the eyes glide",
        ],
        answer: 1,
      },
      {
        question: "What is the parafovea useful for?",
        options: [
          "Recognizing letters in sharp detail",
          "Seeing color at night",
          "Previewing word shapes to aim the next jump",
          "Filtering out distractions",
        ],
        answer: 2,
      },
      {
        question: "Why does cutting regressions raise speed without hurting comprehension?",
        options: [
          "Because the re-reading time was mostly wasted",
          "Because it forces you to subvocalize",
          "Because regressions damage the fovea",
          "Because it shortens fixations",
        ],
        answer: 0,
      },
    ],
  },
  {
    id: "speed",
    title: "The honest limits of speed reading",
    difficulty: "Dense",
    paragraphs: [
      "The claims of the classic speed-reading industry — a thousand words per minute with full comprehension — do not survive contact with the laboratory. Language comprehension has a processing ceiling, and once text moves faster than roughly five to six hundred words per minute, understanding measurably degrades. Anyone advertising more is describing skimming, which is a legitimate skill but a different one.",
      "What the research does support is less glamorous and more useful. Most adults read at two hundred to two hundred fifty words per minute, far below their own ceiling, held back by three trainable habits: fixating on every word rather than every meaningful word, regressing to re-read text they already understood, and subvocalizing — silently pronouncing each word, which chains reading speed to speaking speed.",
      "Each habit yields to deliberate practice. Wider fixation spans come from trusting parafoveal preview. Regressions fade when a pacer enforces forward motion. Subvocalization loosens when the eyes move too quickly for inner speech to keep up. Doubling your reading speed is a realistic outcome; the exotic numbers are not, and chasing them costs the thing reading is for.",
    ],
    quiz: [
      {
        question: "What happens beyond roughly 500–600 words per minute?",
        options: [
          "Comprehension measurably degrades",
          "The eyes can no longer move fast enough",
          "Subvocalization takes over",
          "Nothing — the ceiling is a myth",
        ],
        answer: 0,
      },
      {
        question: "Which of these is NOT one of the three trainable habits named?",
        options: [
          "Fixating on every word",
          "Regressing to re-read",
          "Subvocalizing",
          "Reading without enough light",
        ],
        answer: 3,
      },
      {
        question: "What does the passage call a realistic outcome of practice?",
        options: [
          "Reading at 1,000 words per minute",
          "Doubling your reading speed",
          "Eliminating fixations entirely",
          "Perfect recall of everything read",
        ],
        answer: 1,
      },
    ],
  },
];

export function wordCount(passage: Passage): number {
  return tokenize(passage.paragraphs).length;
}
