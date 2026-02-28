/**
 * Scoring & filtering engine for music video candidates.
 *
 * Each rule contributes a weighted score between 0 and 1.
 * The final score is a weighted average. Explainability is built-in:
 * every rule records its pass/fail status, weight, and detail string.
 */
import type { Candidate, ScoringResult, ScoringReason, AppConfig, RejectionReason } from '../types.js';

// ─── Configurable patterns ───

/** Title patterns that suggest NON-music content */
const NEGATIVE_TITLE_PATTERNS = [
  /\btutorial\b/i,
  /\breaction\b/i,
  /\breview\b/i,
  /\btop\s*\d+\b/i,
  /\bcompilation\b/i,
  /\bhow\s+to\b/i,
  /\bunboxing\b/i,
  /\bpodcast\b/i,
  /\binterview\b/i,
  /\bnews\b/i,
  /\bgameplay\b/i,
  /\btrailer\b/i,
  /\basmr\b/i,
];

/** Title patterns that suggest music content */
const POSITIVE_TITLE_PATTERNS = [
  /\bofficial\s*(music\s*)?video\b/i,
  /\bofficial\s*audio\b/i,
  /\blyric\s*video\b/i,
  /\bft\.\s/i,
  /\bfeat\.\s/i,
  /\bremix\b/i,
  /\bacoustic\b/i,
  /\blive\s*(performance|session|at)\b/i,
  /\b(single|album|ep)\b/i,
];

/** Channel name patterns that suggest non-music channels */
const NEGATIVE_CHANNEL_PATTERNS = [
  /\btutorial/i,
  /\blesson/i,
  /\breact/i,
  /\bnews/i,
  /\bgaming/i,
];

// ─── Scoring Rules ───

type ScoringRule = (candidate: Candidate, config: AppConfig) => ScoringReason;

const durationRule: ScoringRule = (c, config) => {
  const { durationSeconds: dur } = c;
  const { minDurationSeconds: min, maxDurationSeconds: max } = config;
  const passed = dur >= min && dur <= max;
  let detail: string;
  if (dur < min) detail = `Too short: ${dur}s < ${min}s minimum`;
  else if (dur > max) detail = `Too long: ${dur}s > ${max}s maximum`;
  else detail = `Duration ${dur}s is within ${min}–${max}s range`;
  return { rule: 'duration', passed, weight: 0.25, detail };
};

const titlePositiveRule: ScoringRule = (c) => {
  const matches = POSITIVE_TITLE_PATTERNS.filter(p => p.test(c.title));
  const passed = matches.length > 0;
  return {
    rule: 'title-positive',
    passed,
    weight: 0.2,
    detail: passed
      ? `Title matches music patterns: ${matches.map(p => p.source).join(', ')}`
      : 'No positive music title patterns matched',
  };
};

const titleNegativeRule: ScoringRule = (c) => {
  const matches = NEGATIVE_TITLE_PATTERNS.filter(p => p.test(c.title));
  const passed = matches.length === 0;
  return {
    rule: 'title-negative',
    passed,
    weight: 0.25,
    detail: passed
      ? 'No negative title patterns detected'
      : `Title matches non-music patterns: ${matches.map(p => p.source).join(', ')}`,
  };
};

const channelRule: ScoringRule = (c) => {
  const matches = NEGATIVE_CHANNEL_PATTERNS.filter(p => p.test(c.channelName));
  const passed = matches.length === 0;
  return {
    rule: 'channel',
    passed,
    weight: 0.15,
    detail: passed
      ? 'Channel name looks fine'
      : `Channel matches non-music patterns: ${matches.map(p => p.source).join(', ')}`,
  };
};

const freshnesRule: ScoringRule = (c) => {
  const publishDate = new Date(c.publishedAt);
  const ageMonths = (Date.now() - publishDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  // Slight preference for newer content but don't penalize classics
  const passed = true; // Freshness is a soft signal
  const detail = ageMonths < 6
    ? `Fresh content (${Math.round(ageMonths)} months old) — slight boost`
    : `Older content (${Math.round(ageMonths)} months old) — neutral`;
  return { rule: 'freshness', passed, weight: 0.05, detail };
};

const titleLengthRule: ScoringRule = (c) => {
  // Very short or very long titles are suspect
  const len = c.title.length;
  const passed = len >= 5 && len <= 200;
  return {
    rule: 'title-length',
    passed,
    weight: 0.1,
    detail: passed
      ? `Title length ${len} chars — reasonable`
      : `Title length ${len} chars — suspicious`,
  };
};

const ALL_RULES: ScoringRule[] = [
  durationRule,
  titlePositiveRule,
  titleNegativeRule,
  channelRule,
  freshnesRule,
  titleLengthRule,
];

// ─── Public API ───

export function scoreCandidate(candidate: Candidate, config: AppConfig): ScoringResult {
  const reasons = ALL_RULES.map(rule => rule(candidate, config));

  const totalWeight = reasons.reduce((sum, r) => sum + r.weight, 0);
  const weightedScore = reasons.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0);
  const score = totalWeight > 0 ? weightedScore / totalWeight : 0;

  return {
    score: Math.round(score * 1000) / 1000,
    passed: score >= config.minConfidenceScore,
    reasons,
  };
}

/**
 * Derive the primary rejection reason from scoring breakdown.
 * Picks the most impactful failing rule.
 */
export function deriveRejectionReason(scoring: ScoringResult): RejectionReason {
  const failed = scoring.reasons.filter(r => !r.passed);
  if (failed.length === 0) return 'other';

  // Sort by weight descending — heaviest failing rule wins
  const sorted = [...failed].sort((a, b) => b.weight - a.weight);
  const top = sorted[0].rule;

  if (top === 'duration') return 'duration';
  if (top === 'title-negative' || top === 'channel') return 'not_music';
  if (top === 'title-positive') return 'not_music'; // no music signals
  return 'low_confidence';
}

export function filterCandidates(candidates: Candidate[], config: AppConfig): Candidate[] {
  return candidates.map(c => {
    const scoring = scoreCandidate(c, config);
    c.scoring = scoring;
    if (scoring.passed) {
      c.decision = { action: 'accept', reason: `Score ${scoring.score} >= ${config.minConfidenceScore}`, decidedAt: new Date().toISOString() };
    } else {
      const rejectionReason = deriveRejectionReason(scoring);
      c.decision = {
        action: 'reject',
        reason: `Score ${scoring.score} < ${config.minConfidenceScore}`,
        rejectionReason,
        decidedAt: new Date().toISOString(),
      };
    }
    return c;
  });
}
