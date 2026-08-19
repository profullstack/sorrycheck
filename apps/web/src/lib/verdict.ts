import type { ArtifactRow, Check } from '@sorrycheck/db';

export type Tone = 'pass' | 'neutral' | 'attention' | 'unknown';

export interface Verdict {
  label: string;
  tone: Tone;
  /** One sentence a reader can act on. Mechanical facts only. */
  detail: string;
}

/**
 * Turn a check into what the page shows.
 *
 * The tone vocabulary is the fairness policy in code. There is no `fail`:
 *
 * - `not_published` is NEUTRAL and grey. It is a fixable fact about a link, not
 *   a judgement about the work or the author.
 * - a placeholder found in source is `attention`, not a failure — a `sorry` in a
 *   work-in-progress repository is normal and says nothing about the paper.
 * - anything we did not measure is `unknown`, never assumed.
 *
 * Nothing here may produce a sentence about a person.
 */
export function verdictFor(artifact: Pick<ArtifactRow, 'source_status'>, check: Check | null): Verdict {
  if (artifact.source_status === 'not_applicable') {
    return {
      label: 'no formalization claimed',
      tone: 'neutral',
      detail: 'This artifact does not claim a machine-checked formalization.',
    };
  }

  if (artifact.source_status === 'not_published') {
    return {
      label: 'no source published',
      tone: 'neutral',
      detail:
        'We could not find published source for the formalization. If it exists, attaching a repository takes a minute and the page re-checks itself.',
    };
  }

  if (artifact.source_status === 'unreachable') {
    return {
      label: 'source unreachable',
      tone: 'neutral',
      detail:
        'The source location did not respond when we last looked. A private or moved repository looks the same as one that is gone.',
    };
  }

  if (!check) {
    return { label: 'not checked yet', tone: 'unknown', detail: 'This artifact is queued for a check.' };
  }

  if (!check.system) {
    return {
      label: 'no formalization found',
      tone: 'neutral',
      detail: 'The published source does not contain a Lean, Coq or Isabelle project we could recognise.',
    };
  }

  if (check.sorry_total > 0) {
    return {
      label: `${check.sorry_total} placeholder${check.sorry_total === 1 ? '' : 's'} in source`,
      tone: 'attention',
      detail: `${check.sorry_total} of ${check.declarations_total} declarations contain a literal placeholder in the source.`,
    };
  }

  return {
    label: 'no placeholders in source',
    tone: 'pass',
    detail: `${check.declarations_total} declarations, none containing a placeholder in the source.`,
  };
}

/**
 * The sentence that must appear anywhere a verdict does.
 *
 * A static scan and `#print axioms` are different facts, and conflating them is
 * how this registry would publish something false: a file with no `sorry` token
 * can still depend on `sorryAx` through a declaration in another file.
 */
export const STATIC_SCOPE_NOTE =
  'This is a static reading of the published source: which declarations exist and which contain a placeholder token. It is not a build, and not the `#print axioms` probe — a declaration can depend on sorryAx transitively without containing the token itself.';

export const TONE_CLASSES: Record<Tone, string> = {
  pass: 'border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400',
  attention: 'border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400',
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  unknown: 'border-border bg-muted/30 text-muted-foreground',
};
