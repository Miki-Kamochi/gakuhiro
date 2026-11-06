"use client";

import { useState } from "react";
import styles from "./styles";

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  answer: string;
  explanation: string;
};

export default function Quiz({ questions }: { questions: QuizQuestion[] }) {
  const [picked, setPicked] = useState<Record<string, string>>({});

  const answered = questions.filter((q) => picked[q.id] !== undefined).length;
  const correct = questions.filter((q) => picked[q.id] === q.answer).length;

  return (
    <div className={styles.quiz}>
      {questions.map((q, index) => {
        const choice = picked[q.id];
        const isCorrect = choice === q.answer;
        return (
          <fieldset key={q.id} className={styles.question}>
            <legend>
              <span className={styles.qNum}>{index + 1}</span>
              {q.prompt}
            </legend>
            <div className={styles.options}>
              {q.options.map((o) => {
                const inputId = `${q.id}-${o.id}`;
                let state = "";
                if (choice === o.id) state = isCorrect ? styles.optionCorrect : styles.optionWrong;
                return (
                  <label key={o.id} htmlFor={inputId} className={`${styles.option} ${state}`}>
                    <input
                      id={inputId}
                      type="radio"
                      name={q.id}
                      value={o.id}
                      checked={choice === o.id}
                      onChange={() => setPicked((prev) => ({ ...prev, [q.id]: o.id }))}
                    />
                    <span>{o.text}</span>
                  </label>
                );
              })}
            </div>
            {choice !== undefined && (
              <p className={styles.feedback} aria-live="polite">
                <span className={isCorrect ? styles.feedbackVerdictGood : styles.feedbackVerdictBad}>
                  {isCorrect ? "Correct. " : "Not quite. Try another answer. "}
                </span>
                {isCorrect ? q.explanation : null}
              </p>
            )}
          </fieldset>
        );
      })}
      <p className={styles.score} aria-live="polite">
        {answered === 0
          ? `${questions.length} questions. Pick an answer to check it.`
          : `${correct} of ${questions.length} correct so far.`}
      </p>
    </div>
  );
}
