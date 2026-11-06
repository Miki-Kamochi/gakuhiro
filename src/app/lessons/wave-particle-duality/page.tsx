import type { Metadata } from "next";
import DeBroglieCalculator from "@/components/lesson/DeBroglieCalculator";
import DoubleSlitLab from "@/components/lesson/DoubleSlitLab";
import Quiz, { type QuizQuestion } from "@/components/lesson/Quiz";
import styles from "@/components/lesson/styles";

export const metadata: Metadata = {
  title: "Wave–Particle Duality · Quantum Physics",
  description:
    "Lesson 1 of the quantum physics unit: photons, matter waves, and the double-slit experiment, with interactive labs.",
};

const QUESTIONS: QuizQuestion[] = [
  {
    id: "q-dot",
    prompt: "Single electrons are sent through a double slit, one at a time. What does each electron leave on the screen?",
    options: [
      { id: "a", text: "A faint copy of the whole interference pattern" },
      { id: "b", text: "One dot, at a single spot" },
      { id: "c", text: "Two dots, one behind each slit" },
      { id: "d", text: "Nothing until thousands of electrons have arrived" },
    ],
    answer: "b",
    explanation:
      "Each electron is detected as one particle at one place. The bands only appear in the pattern made by many electrons, because the wave sets the odds of where each one lands.",
  },
  {
    id: "q-speed",
    prompt: "An electron doubles its speed (well below light speed). What happens to its de Broglie wavelength?",
    options: [
      { id: "a", text: "It doubles" },
      { id: "b", text: "It stays the same" },
      { id: "c", text: "It halves" },
      { id: "d", text: "It becomes four times smaller" },
    ],
    answer: "c",
    explanation: "λ = h / p and p = mv. Doubling v doubles p, so λ is cut in half.",
  },
  {
    id: "q-watch",
    prompt: "A detector is added that records which slit each photon goes through. What happens to the pattern?",
    options: [
      { id: "a", text: "The bands get sharper" },
      { id: "b", text: "The bands disappear and one broad band is left" },
      { id: "c", text: "Nothing changes" },
      { id: "d", text: "The whole pattern shifts to one side" },
    ],
    answer: "b",
    explanation:
      "Knowing the path removes the interference between the two routes. The hits then follow the single-slit spread. Try the “Watch which slit” switch in Lab 1.",
  },
  {
    id: "q-spacing",
    prompt: "Green light (532 nm) passes through slits 0.25 mm apart onto a screen 1.0 m away. About how far apart are the bright bands?",
    options: [
      { id: "a", text: "0.21 mm" },
      { id: "b", text: "2.1 mm" },
      { id: "c", text: "21 mm" },
      { id: "d", text: "0.47 mm" },
    ],
    answer: "b",
    explanation:
      "Δy = λL / d = (532 × 10⁻⁹ m)(1.0 m) / (0.25 × 10⁻³ m) = 2.1 × 10⁻³ m. Lab 1 opens with exactly these settings.",
  },
];

export default function WaveParticleDualityLesson() {
  return (
    <div className={styles.lesson}>
      <article className={styles.article}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Quantum Physics · Lesson 1</p>
          <h1 className={styles.title}>Wave–Particle Duality</h1>
          <p className={styles.lede}>
            Light arrives in single lumps, yet spreads out like a wave. Electrons do the same. This lesson shows the
            evidence and the two equations that tie the pictures together.
          </p>
          <section className={styles.goals} aria-labelledby="goals-title">
            <h2 id="goals-title">By the end you can</h2>
            <ul>
              <li>Find the energy of a photon from its frequency or wavelength.</li>
              <li>Find the de Broglie wavelength of a moving particle.</li>
              <li>Explain how single particles build up an interference pattern.</li>
            </ul>
          </section>
        </header>

        <section className={styles.section} aria-labelledby="s1">
          <h2 id="s1">
            <span className={styles.sectionNum}>1.1</span> Light comes in lumps
          </h2>
          <p>
            For most of the 1800s the question seemed settled: light is a wave. It bends around edges and makes
            bright and dark bands when two beams overlap. Then in 1905 Albert Einstein explained a puzzle that
            waves could not.
          </p>
          <p>
            Shine light on a clean metal and electrons fly off. This is the <span className={styles.term}>photoelectric effect</span>.
            Brighter light knocks out <em>more</em> electrons, but not faster ones. And for each metal there is a
            cut-off: light below a certain frequency frees no electrons at all, however bright it is, while light above
            it works at once, even when it is dim. Einstein proposed that light is delivered in
            packets, now called <span className={styles.term}>photons</span>, each carrying a fixed amount of energy set by
            its frequency:
          </p>
          <div className={styles.equation}>
            <span className={styles.equationBody}>
              <span className={styles.v}>E</span> = <span className={styles.v}>h f</span> ={" "}
              <span className={styles.frac}>
                <span>
                  <span className={styles.v}>hc</span>
                </span>
                <span className={styles.v}>λ</span>
              </span>
            </span>
            <span className={styles.equationLabel}>(1.1)</span>
          </div>
          <p>
            Here <span className={styles.v}>h</span> = 6.626 × 10⁻³⁴ J·s is Planck’s constant, <span className={styles.v}>f</span> is
            the frequency, <span className={styles.v}>c</span> is the speed of light and <span className={styles.v}>λ</span> is
            the wavelength. One electron absorbs one photon. If a single photon lacks the energy to free an electron,
            sending more of them does not help.
          </p>
          <div className={styles.example}>
            <p className={styles.exampleTitle}>Worked example · a green laser photon</p>
            <p>What is the energy of one photon from a 532 nm green laser pointer?</p>
            <ul className={styles.steps}>
              <li>
                <span className={styles.v}>E</span> = <span className={styles.v}>hc</span> / <span className={styles.v}>λ</span> = (6.626
                × 10⁻³⁴ J·s)(2.998 × 10⁸ m/s) / (532 × 10⁻⁹ m)
              </li>
              <li>
                <span className={styles.v}>E</span> = 3.73 × 10⁻¹⁹ J ≈ 2.33 eV
              </li>
            </ul>
            <p>
              A 5 mW pointer therefore sends out about 1.3 × 10¹⁶ photons every second, which is why light usually
              looks smooth.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="s2">
          <h2 id="s2">
            <span className={styles.sectionNum}>1.2</span> One photon at a time
          </h2>
          <p>
            If light is made of photons, what happens to the classic double-slit experiment when the light is so dim
            that only one photon is in the apparatus at a time? Each photon lands as a single dot. The first few dots
            look random. Keep going, and the dots pile up into the same bright and dark bands a wave would make.
          </p>
          <p>
            The lab below runs that experiment. Press <strong>Play</strong> and watch the first hits arrive one by one,
            then fill in the bands. The white curve is the wave prediction for where the light should be brightest.
          </p>
        </section>

        <DoubleSlitLab />

        <div className={`${styles.section} ${styles.continued}`}>
          <p>
            For small angles, the distance between neighbouring bright bands depends on the wavelength{" "}
            <span className={styles.v}>λ</span>, the distance to the screen <span className={styles.v}>L</span> and the
            slit separation <span className={styles.v}>d</span>:
          </p>
          <div className={styles.equation}>
            <span className={styles.equationBody}>
              Δ<span className={styles.v}>y</span> ={" "}
              <span className={styles.frac}>
                <span>
                  <span className={styles.v}>λ L</span>
                </span>
                <span className={styles.v}>d</span>
              </span>
            </span>
            <span className={styles.equationLabel}>(1.2)</span>
          </div>
          <p>
            Try it in the lab. A longer wavelength or slits closer together spread the bands out. Now turn on{" "}
            <strong>Watch which slit</strong>. Once the apparatus records which slit each photon went through, the
            bands vanish and only a single broad hump remains. Interference needs both routes to stay possible.
          </p>
          <p className={styles.aside}>
            The same build-up happens with electrons. In 1989 a team at Hitachi led by Akira Tonomura sent
            electrons one at a time through an electron biprism, the electron version of a double slit, and filmed
            the bands forming dot by dot.
          </p>
        </div>

        <section className={styles.section} aria-labelledby="s3">
          <h2 id="s3">
            <span className={styles.sectionNum}>1.3</span> Matter has a wavelength too
          </h2>
          <p>
            In 1924 Louis de Broglie turned the idea around. If waves of light behave like particles, perhaps
            particles of matter behave like waves. He proposed that anything with momentum{" "}
            <span className={styles.v}>p</span> has a wavelength:
          </p>
          <div className={styles.equation}>
            <span className={styles.equationBody}>
              <span className={styles.v}>λ</span> ={" "}
              <span className={styles.frac}>
                <span>
                  <span className={styles.v}>h</span>
                </span>
                <span className={styles.v}>p</span>
              </span>{" "}
              ={" "}
              <span className={styles.frac}>
                <span>
                  <span className={styles.v}>h</span>
                </span>
                <span className={styles.v}>m v</span>
              </span>
            </span>
            <span className={styles.equationLabel}>(1.3)</span>
          </div>
          <p>
            Three years later Clinton Davisson and Lester Germer fired electrons at a nickel crystal and saw them
            bounce off in the angles a wave would choose. The rows of atoms acted as a grating, because the
            electrons’ wavelength was close to the spacing between atoms.
          </p>
          <div className={styles.example}>
            <p className={styles.exampleTitle}>Worked example · electron versus baseball</p>
            <p>An electron moves at 1.0 × 10⁶ m/s. A 0.145 kg baseball moves at 40 m/s. Compare their wavelengths.</p>
            <ul className={styles.steps}>
              <li>
                Electron: <span className={styles.v}>λ</span> = (6.626 × 10⁻³⁴) / (9.11 × 10⁻³¹ × 1.0 × 10⁶) = 7.3 ×
                10⁻¹⁰ m ≈ 0.73 nm
              </li>
              <li>
                Baseball: <span className={styles.v}>λ</span> = (6.626 × 10⁻³⁴) / (0.145 × 40) = 1.1 × 10⁻³⁴ m
              </li>
            </ul>
            <p>
              The electron’s wavelength is a few atoms wide, so atoms can diffract it. The baseball’s is about 10¹⁹
              times smaller than an atomic nucleus, so nothing can.
            </p>
          </div>
          <p>Use the lab to see where other objects land, from protons to molecules of 60 carbon atoms.</p>
        </section>

        <DeBroglieCalculator />

        <section className={styles.section} aria-labelledby="s4">
          <h2 id="s4">
            <span className={styles.sectionNum}>1.4</span> What is waving?
          </h2>
          <p>
            In Lab 1 no single photon was spread out across the screen. Each one landed in one place. What the wave
            controlled was the <em>chance</em> of landing at each place. In 1926 Max Born gave the rule still used today:
            a particle is described by a wave, written <span className={styles.v}>ψ</span> (psi), and the probability of
            finding the particle at a spot is proportional to <span className={styles.v}>|ψ|²</span> there.
          </p>
          <p>
            So the two pictures answer different questions. The wave tells you how a particle travels and where it is
            likely to turn up. The particle is what you find when you look. Neither picture alone is the whole story,
            and that is what <span className={styles.term}>wave–particle duality</span> means.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="s5">
          <h2 id="s5">
            <span className={styles.sectionNum}>1.5</span> Check your understanding
          </h2>
          <Quiz questions={QUESTIONS} />
        </section>

        <section className={styles.section} aria-labelledby="s6">
          <h2 id="s6">
            <span className={styles.sectionNum}>1.6</span> Summary
          </h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Equation</th>
                  <th scope="col">What it tells you</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className={styles.v}>E</span> = <span className={styles.v}>hf</span>
                  </td>
                  <td>Energy of one photon of frequency f</td>
                </tr>
                <tr>
                  <td>
                    <span className={styles.v}>λ</span> = <span className={styles.v}>h</span> / <span className={styles.v}>p</span>
                  </td>
                  <td>Wavelength of any particle with momentum p</td>
                </tr>
                <tr>
                  <td>
                    Δ<span className={styles.v}>y</span> = <span className={styles.v}>λL</span> / <span className={styles.v}>d</span>
                  </td>
                  <td>Spacing of bright bands from two slits</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className={styles.takeaways}>
            <li>Light is absorbed and detected in whole photons, each with energy hf.</li>
            <li>Every moving particle has a wavelength h/p. It only shows when it is close to the size of what the particle meets.</li>
            <li>Single particles land at single points. Their wave sets the odds, and many hits reveal the interference pattern.</li>
            <li>Finding out which path a particle took destroys the interference.</li>
          </ul>
        </section>

        <footer className={styles.footer}>
          Constants: h = 6.626 × 10⁻³⁴ J·s, c = 2.998 × 10⁸ m/s, electron mass 9.109 × 10⁻³¹ kg, 1 eV = 1.602 × 10⁻¹⁹ J.
        </footer>
      </article>
    </div>
  );
}
