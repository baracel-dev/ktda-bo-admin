import clsx from "clsx";

/* The Nawiri brand, drawn inline from the brand pack's vector sources
 * (brand-src/nawiri/dist/svg): the icon tile (nawiri-icon.svg) and the outlined
 * wordmark (nawiri-wordmark-light/-dark.svg). The tile keeps the pack's own
 * colours on every ground; the wordmark's ink and i-dots come from tokens.css
 * (--brand-wordmark-*) so .dark switches them to the pack's on-dark colours.
 * public/favicon.svg / favicon.ico / apple-touch-icon.png come from the pack too. */

const LEAF = "var(--brand-leaf)";

/* nawiri-icon.svg, on its 64-unit box. */
const TILE = "#B3502A";
const SUN = "#F7C653";
const ROWS = "#FBF6EE";
/* nawiri-mark.svg's colours, for the symbol on a white tile. */
const SUN_ON_PAPER = "#D98E0C";
const SUN_PATH =
  "M19 31.2C19 25 23.34 19.81 29.15 18.51L26.01 31.2ZM37.99 31.2 34.85 18.51C40.66 19.81 45 25 45 31.2H37.99ZM28.81 31.2 30.51 18.28C31 18.23 31.5 18.2 32 18.2C32.5 18.2 33 18.23 33.49 18.28L35.19 31.2Z";
const ROWS_PATH = "M28.44 34H35.56L37.93 52H26.07ZM38.68 34H45.8L55 52H43.13ZM18.2 34H25.32L20.87 52H9Z";

/* nawiri-wordmark-*.svg: letters on the baseline (y 0), i-dots above; the box is x 3..274.9, y -74.22..5.4. */
const WORD_PATH =
  "M125.2 0 118.2 -49.6H130.7L135.1 -8.5H136.9L143.3 -49.6H163.5L169.9 -8.5H171.7L176.1 -49.6H188.6L181.6 0H160.7L154.3 -41.1H152.5L146.1 0ZM81.5 1.4Q76.2 1.4 72 -0.45Q67.8 -2.3 65.35 -5.85Q62.9 -9.4 62.9 -14.5Q62.9 -19.6 65.35 -23.05Q67.8 -26.5 72.15 -28.25Q76.5 -30 82.1 -30H95.7V-32.8Q95.7 -36.3 93.5 -38.55Q91.3 -40.8 86.5 -40.8Q81.8 -40.8 79.5 -38.65Q77.2 -36.5 76.5 -33.1L64.9 -37Q66.1 -40.8 68.75 -43.95Q71.4 -47.1 75.85 -49.05Q80.3 -51 86.7 -51Q96.5 -51 102.2 -46.1Q107.9 -41.2 107.9 -31.9V-13.4Q107.9 -10.4 110.7 -10.4H114.7V0H106.3Q102.6 0 100.2 -1.8Q97.8 -3.6 97.8 -6.6V-6.7H95.9Q95.5 -5.5 94.1 -3.55Q92.7 -1.6 89.7 -0.1Q86.7 1.4 81.5 1.4ZM7 0V-49.6H19.4V-43.1H21.2Q22.4 -45.7 25.7 -48.05Q29 -50.4 35.7 -50.4Q41.5 -50.4 45.85 -47.75Q50.2 -45.1 52.6 -40.45Q55 -35.8 55 -29.6V0H42.4V-28.6Q42.4 -34.2 39.65 -37Q36.9 -39.8 31.8 -39.8Q26 -39.8 22.8 -35.95Q19.6 -32.1 19.6 -25.2V0ZM221.2 0V-49.6H233.6V-44H235.4Q236.5 -47 239.05 -48.4Q241.6 -49.8 245 -49.8H251V-38.6H244.8Q240 -38.6 236.9 -36.05Q233.8 -33.5 233.8 -28.2V0ZM258.3 0V-49.6H270.9V0ZM197.1 0V-49.6H209.7V0ZM83.7 -8.8Q89 -8.8 92.35 -11.75Q95.7 -14.7 95.7 -19.6V-20.6H83Q79.5 -20.6 77.5 -19.1Q75.5 -17.6 75.5 -14.9Q75.5 -12.2 77.6 -10.5Q79.7 -8.8 83.7 -8.8Z";

/** The icon tile at 40 units, so the lockups can place it at x 0..40. */
function Tile({ white = false }: { white?: boolean }) {
  return (
    <g transform="scale(0.625)">
      <rect width="64" height="64" rx="14" fill={white ? "#fff" : TILE} />
      <g transform="translate(4.17 0.78) scale(0.87)">
        <path d={SUN_PATH} fill={white ? SUN_ON_PAPER : SUN} />
        <path d={ROWS_PATH} fill={white ? TILE : ROWS} />
      </g>
    </g>
  );
}

/** The wordmark with its left edge at `x` and its baseline at `baseline`, `scale` units per wordmark unit. */
function Wordmark({ x, baseline, scale }: { x: number; baseline: number; scale: number }) {
  return (
    <g transform={`translate(${x - 3 * scale} ${baseline}) scale(${scale})`}>
      <path d={WORD_PATH} fill="var(--brand-wordmark-ink)" />
      <circle cx="203.4" cy="-62.41" r="7.81" fill="var(--brand-wordmark-sun)" />
      <circle cx="264.6" cy="-62.41" r="7.81" fill="var(--brand-wordmark-sun)" />
    </g>
  );
}

/** The square mark: the Nawiri icon tile. `size` is its height. */
export function BrandMark({ size = 36, tone = "auto", className }: { size?: number; tone?: "auto" | "white"; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" height={size} width={size} className={clsx("shrink-0", className)} role="img" aria-label="Nawiri">
      <Tile white={tone === "white"} />
    </svg>
  );
}

/** The mark with the Nawiri wordmark. `size` is the mark's height. */
export function BrandLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 146 40" height={size} width={(size * 146) / 40} className={clsx("shrink-0", className)} role="img" aria-label="Nawiri">
      <Tile />
      <Wordmark x={50} baseline={31.7} scale={0.34} />
    </svg>
  );
}

/** The lockup: mark, Nawiri, and BACK OFFICE beneath. */
export function BrandLockup({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 150 40" height={size} width={(size * 150) / 40} className={clsx("shrink-0", className)} role="img" aria-label="Nawiri Back Office">
      <Tile />
      <Wordmark x={50} baseline={21} scale={0.27} />
      <text x="50" y="35" fontFamily="var(--font-sans)" fontWeight="500" fontSize="9" letterSpacing="2" fill={LEAF}>BACK OFFICE</text>
    </svg>
  );
}
