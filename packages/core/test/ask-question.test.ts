import { describe, expect, it } from "vitest";
import type { AskUserQuestion } from "../src/ask-question.js";
import { validateAnswer, validateQuestion } from "../src/ask-question.js";

const validQ: AskUserQuestion = {
  title: "Auth method",
  description: "Which authentication method should we use?",
  options: [
    { label: "JWT", value: "jwt", description: "Stateless token auth" },
    { label: "Session", value: "session", description: "Server-side sessions" },
  ],
};

describe("validateQuestion", () => {
  it("accepts valid question", () => {
    expect(() => validateQuestion(validQ)).not.toThrow();
  });

  it("rejects missing title", () => {
    expect(() => validateQuestion({ ...validQ, title: "" })).toThrow("title");
  });

  it("rejects missing description", () => {
    expect(() => validateQuestion({ ...validQ, description: "" })).toThrow("description");
  });

  it("rejects fewer than 2 options", () => {
    expect(() => validateQuestion({ ...validQ, options: [{ label: "A", value: "a" }] })).toThrow("at least 2");
  });

  it("rejects more than 4 options", () => {
    expect(() =>
      validateQuestion({
        ...validQ,
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
          { label: "C", value: "c" },
          { label: "D", value: "d" },
          { label: "E", value: "e" },
        ],
      }),
    ).toThrow("at most 4");
  });

  it("rejects option without label", () => {
    expect(() =>
      validateQuestion({
        ...validQ,
        options: [
          { label: "", value: "a" },
          { label: "B", value: "b" },
        ],
      }),
    ).toThrow("label");
  });
});

describe("validateAnswer", () => {
  it("accepts valid single answer", () => {
    expect(() => validateAnswer(validQ, { values: ["jwt"] })).not.toThrow();
  });

  it("rejects empty values", () => {
    expect(() => validateAnswer(validQ, { values: [] })).toThrow("at least one");
  });

  it("rejects multiple values for single-select", () => {
    expect(() => validateAnswer(validQ, { values: ["jwt", "session"] })).toThrow("Single-select");
  });

  it("accepts multiple values for multi-select", () => {
    const q: AskUserQuestion = { ...validQ, multiple: true };
    expect(() => validateAnswer(q, { values: ["jwt", "session"] })).not.toThrow();
  });

  it("rejects invalid option value", () => {
    expect(() => validateAnswer(validQ, { values: ["oauth"] })).toThrow("not a valid option");
  });

  it("accepts free-text when allowed", () => {
    const q: AskUserQuestion = { ...validQ, freeTextAllowed: true };
    expect(() => validateAnswer(q, { values: ["custom_value"] })).not.toThrow();
  });
});
