/**
 * AskUserQuestion — structured user query when agent needs clarification.
 */

export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface AskUserQuestion {
  /** Question title */
  title: string;
  /** Full question description */
  description: string;
  /** Available options */
  options: QuestionOption[];
  /** Whether multiple selections are allowed */
  multiple?: boolean;
  /** Default selected value(s) */
  defaultValue?: string | string[];
  /** Whether free-text input is allowed */
  freeTextAllowed?: boolean;
}

export interface UserAnswer {
  /** Selected values */
  values: string[];
  /** Free-text input if allowed */
  freeText?: string;
}

/**
 * Validate a question structure.
 * Throws if the question is malformed.
 */
export function validateQuestion(q: AskUserQuestion): void {
  if (!q.title) throw new Error("Question must have a title");
  if (!q.description) throw new Error("Question must have a description");
  if (!q.options || q.options.length < 2) throw new Error("Question must have at least 2 options");
  if (q.options.length > 4) throw new Error("Question must have at most 4 options");
  for (const opt of q.options) {
    if (!opt.label || !opt.value) throw new Error("Each option must have a label and value");
  }
}

/**
 * Validate an answer against a question.
 */
export function validateAnswer(q: AskUserQuestion, a: UserAnswer): void {
  if (!a.values || a.values.length === 0) {
    throw new Error("Answer must have at least one selected value");
  }
  if (!q.multiple && a.values.length > 1) {
    throw new Error("Single-select question cannot have multiple values");
  }
  for (const v of a.values) {
    if (!q.options.some((o) => o.value === v) && !q.freeTextAllowed) {
      throw new Error(`Value "${v}" is not a valid option`);
    }
  }
}
