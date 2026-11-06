import Link from "next/link";
import styles from "@/components/lesson/styles";

type LessonEntry = { slug: string; title: string; summary: string; includes: string };
type Unit = { id: string; name: string; lessons: LessonEntry[] };

// Table of contents. Add new lessons here as they are written.
const UNITS: Unit[] = [
  {
    id: "quantum",
    name: "Quantum Physics",
    lessons: [
      {
        slug: "wave-particle-duality",
        title: "Wave–Particle Duality",
        summary: "Photons, matter waves and the double-slit experiment.",
        includes: "2 labs · 4-question quiz",
      },
    ],
  },
];

export default function Home() {
  return (
    <div className={styles.lesson}>
      <main className={styles.article}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Interactive physics textbook</p>
          <h1 className={styles.title}>Gakuhiro Physics</h1>
          <p className={styles.lede}>
            Short lessons with worked examples, labs you can run right in the page, and a quick quiz at the end of
            each one.
          </p>
        </header>

        {UNITS.map((unit, u) => (
          <section key={unit.id} className={styles.section} aria-labelledby={`unit-${unit.id}`}>
            <h2 id={`unit-${unit.id}`}>
              <span className={styles.sectionNum}>Unit {u + 1}</span> {unit.name}
            </h2>
            <ol className={styles.toc}>
              {unit.lessons.map((lesson, i) => (
                <li key={lesson.slug}>
                  <Link href={`/lessons/${lesson.slug}`} className={styles.tocLink}>
                    <span className={styles.tocNum}>{i + 1}</span>
                    <span className={styles.tocBody}>
                      <span className={styles.tocTitle}>{lesson.title}</span>
                      <span className={styles.tocSummary}>{lesson.summary}</span>
                      <span className={styles.tocMeta}>{lesson.includes}</span>
                    </span>
                    <span className={styles.tocArrow} aria-hidden="true">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </main>
    </div>
  );
}
