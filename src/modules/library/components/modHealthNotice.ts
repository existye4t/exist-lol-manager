/*
 * What a health finding amounts to and how loudly it is drawn, shared by the
 * status bar item, the card badge, the drawer and the launch ask.
 *
 * Per "How loud a finding is drawn" in docs/ux/MOD_HEALTH.md.
 */

import { type ModHealthVerdict } from "@/lib/tauri";

/**
 * How loudly a finding is announced, which the verdict alone cannot answer.
 *
 * `unrepairable` covers a mod the game will refuse to load and a mod that plays
 * with one effect missing, and those two do not deserve the same hue. The
 * verdict says what a repair can do, and the severity says how much it matters.
 */
export type SweepAlarm =
  /** A repair reaches it, so the errand is a press rather than a search. */
  | "repairable"
  /** No repair, and the game is what pays: a fatal or an error. */
  | "broken"
  /** No repair, and nothing worse than a warning. It loads, and it plays. */
  | "flagged";

export interface SweepTone {
  /**
   * The header's tint, thinning out across the row.
   *
   * It fades rather than filling, so the tone reads as a wash off the glyph
   * that names it instead of a banner boxed around the title.
   */
  wash: string;
  /**
   * The rule under the header, which fades out with the wash above it.
   *
   * A background rather than a border, because a border cannot be a gradient
   * without giving up the radius the panel is cut with.
   */
  rule: string;
  /** The badge behind the glyph that names the finding. */
  chip: string;
  /**
   * The card badge's pill, which rings its tint rather than bordering it.
   *
   * A ring so the pill keeps its own height in a row of card chrome, where a
   * border would spend a pixel of it.
   */
  pill: string;
  /**
   * The status bar cell, as the status hue's own `duotone` Button.
   *
   * Every state carries its own counterpart of the `duotone` variant it
   * overrides, or twMerge leaves the variant's accent standing.
   */
  cell: string;
  /**
   * The cell while the drawer it opened is still showing.
   *
   * It holds the pressed tint and takes the hover a step past it, so the one
   * control does not go quieter under the pointer than it sits at rest.
   */
  held: string;
}

const WARNING: SweepTone = {
  wash: "bg-linear-to-r from-warning/15 to-warning/0",
  rule: "bg-linear-to-r from-warning/50 to-warning/0",
  chip: "text-warning-text",
  pill: "bg-warning/15 text-warning-text ring-warning/30 hover:bg-warning/25",
  cell: "bg-warning/15 text-warning-text hover:bg-warning/25 active:bg-warning/35 border border-warning/35",
  held: "bg-warning/35 hover:bg-warning/45",
};

const DANGER: SweepTone = {
  wash: "bg-linear-to-r from-danger/15 to-danger/0",
  rule: "bg-linear-to-r from-danger/50 to-danger/0",
  chip: "text-danger-text",
  pill: "bg-danger/15 text-danger-text ring-danger/30 hover:bg-danger/25",
  cell: "bg-danger/15 text-danger-text hover:bg-danger/25 active:bg-danger/35 border border-danger/35",
  held: "bg-danger/35 hover:bg-danger/45",
};

/**
 * The same shape as the two above, in no hue at all.
 *
 * Grey is the point: a mod that loads and plays is news the bar carries without
 * claiming anything is on fire. It is still a chip rather than bare text, so it
 * is found where the other two are found.
 */
const MUTED: SweepTone = {
  wash: "bg-linear-to-r from-surface-400/12 to-surface-400/0",
  rule: "bg-linear-to-r from-surface-400/40 to-surface-400/0",
  chip: "text-surface-400",
  pill: "bg-surface-400/12 text-surface-300 ring-surface-400/25 hover:bg-surface-400/20",
  cell: "bg-surface-400/12 text-surface-300 hover:bg-surface-400/20 active:bg-surface-400/30 border border-surface-400/25",
  held: "bg-surface-400/30 hover:bg-surface-400/40",
};

const TONES: Record<SweepAlarm, SweepTone> = {
  repairable: WARNING,
  broken: DANGER,
  flagged: MUTED,
};

/** What `alarm` is drawn in, on every surface that draws it. */
export function toneOf(alarm: SweepAlarm): SweepTone {
  return TONES[alarm];
}

/** The rung one mod is drawn at. */
export function alarmOf(verdict: ModHealthVerdict): SweepAlarm {
  if (verdict.health === "repairable") return "repairable";
  if (verdict.counts.fatals + verdict.counts.errors > 0) return "broken";
  return "flagged";
}

/**
 * The rung a surface over several mods is drawn at.
 *
 * A repair on offer leads whatever else is in the list, because the press is
 * what the reader is being sent to - a library five presses from fixed is not
 * one to paint red over the one mod that has to be replaced instead.
 */
export function alarmOver(verdicts: ModHealthVerdict[]): SweepAlarm {
  const alarms = verdicts.map(alarmOf);
  if (alarms.includes("repairable")) return "repairable";
  if (alarms.includes("broken")) return "broken";
  return "flagged";
}

/**
 * The drawer's title, which is the same in every state the drawer has.
 *
 * What varies is whether a repair can reach any of it, and the line underneath
 * is where that is said - a title that answered it too would say it twice.
 */
export const HEADLINE = "Detected issues with mods";

/**
 * The title for a panel holding nothing that is wrong.
 *
 * Reached by a press on one mod whose findings are all informative. The library
 * stays quiet about those, so the panel is the only place they are read - and
 * it cannot call them issues while it draws them.
 */
export const NO_PROBLEMS = "No problems found";

/**
 * What is wrong with a library, as one string two runs compare by.
 *
 * Sorted, so library order is not a change. Infos are out: they are not a
 * fault - see "The verdict" in docs/ux/MOD_HEALTH.md.
 */
export function announcementKey(verdicts: ModHealthVerdict[]): string {
  return verdicts
    .map(({ modId, health, counts }) =>
      [modId, health, counts.fatals, counts.errors, counts.warnings].join(":"),
    )
    .sort()
    .join("|");
}
