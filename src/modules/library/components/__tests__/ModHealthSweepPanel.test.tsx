// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModRepairProgress } from "@/lib/tauri";
import type { BrokenMods } from "@/modules/library";
import { useModHealthDrawerStore } from "@/stores";

import { ModHealthSweepPanel } from "../ModHealthSweepPanel";
import { brokenMods, installedMod, verdict } from "./modHealthFixtures";

const useBrokenMods = vi.fn<() => BrokenMods>();
const useInstalledMods = vi.fn<() => { data: ReturnType<typeof installedMod>[] }>();
const repairOne = vi.fn();
const cancelRun = vi.fn();
const onClose = vi.fn();

vi.mock("../../api", () => ({
  useModHealthVerdicts: () => ({ data: verdicts }),
  useBrokenMods: () => useBrokenMods(),
  useInstalledMods: () => useInstalledMods(),
  useRepairMod: () => ({ mutate: repairOne, isPending: false }),
  useRepairMods: () => run,
  useCancelModHealthRun: () => ({ mutate: cancelRun, isPending: false }),
  /* The real hook over the two mocked ones, so a test that switches a mod off
     exercises the split the panel actually draws. */
  useRepairTargets: () => {
    const all = useBrokenMods().repairable;
    const on = new Set(
      useInstalledMods()
        .data.filter((mod) => mod.enabled)
        .map((mod) => mod.id),
    );
    return { enabled: all.filter((verdict) => on.has(verdict.modId)), all };
  },
}));

let run: { repair: () => void; isRepairing: boolean; progress: ModRepairProgress | null };
/** What the library remembers, which is more than the unhealthy mods. */
let verdicts: Record<string, ReturnType<typeof verdict>>;

function show(broken: Partial<Omit<BrokenMods, "all">>) {
  useBrokenMods.mockReturnValue(brokenMods(broken));
  render(<ModHealthSweepPanel onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  run = { repair: vi.fn(), isRepairing: false, progress: null };
  verdicts = {};
  useModHealthDrawerStore.setState({ focusModId: null });
  useInstalledMods.mockReturnValue({
    data: [installedMod("a", "Charizard Smolder"), installedMod("b", "Old Ashe Rework")],
  });
});

describe("ModHealthSweepPanel", () => {
  /* Story: Check Health on a mod whose findings are all informative used to
     answer with a count in a toast, which named them without showing them. */
  it("lists the mod a press asked about, though nothing about it is wrong", () => {
    verdicts = { a: verdict("a", "healthy", { findings: 3, severity: "info" }) };
    useModHealthDrawerStore.setState({ focusModId: "a" });
    show({});

    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
  });

  /* The panel cannot call them issues in its title while it draws them. */
  it("does not call a list with nothing wrong in it a list of issues", () => {
    verdicts = { a: verdict("a", "healthy", { findings: 3, severity: "info" }) };
    useModHealthDrawerStore.setState({ focusModId: "a" });
    show({});

    expect(screen.getByRole("heading", { name: "No problems found" })).toBeInTheDocument();
    expect(
      screen.getByText("These findings are worth knowing, and none of them is a fault"),
    ).toBeInTheDocument();
  });

  /* A row missing no press has nothing to say in the press's seat, and
     "Not auto-fixable" over a mod that is fine is the wrong errand. */
  it("sends a healthy row nowhere", () => {
    verdicts = { a: verdict("a", "healthy", { findings: 3, severity: "info" }) };
    useModHealthDrawerStore.setState({ focusModId: "a" });
    show({});

    expect(screen.queryByText("Not auto-fixable")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs an updated version")).not.toBeInTheDocument();
  });

  /* A mod already in the list is not listed twice for having been asked about. */
  it("does not repeat a mod the list already holds", () => {
    verdicts = { a: verdict("a", "repairable") };
    useModHealthDrawerStore.setState({ focusModId: "a" });
    show({ repairable: [verdict("a", "repairable")] });

    expect(screen.getAllByText("Charizard Smolder")).toHaveLength(1);
  });

  /* The title says what was found. Which of the two errands the reader is on is
     the line underneath, and it is one of three. */
  it("promises the repair when every finding can be reached", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByRole("heading", { name: "Detected issues with mods" })).toBeInTheDocument();
    expect(screen.getByText(/All of them can be repaired automatically/)).toBeInTheDocument();
  });

  it("sends the reader after new versions when no repair can reach them", () => {
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable")] });

    expect(screen.getByRole("heading", { name: "Detected issues with mods" })).toBeInTheDocument();
    expect(screen.getByText(/None of them are auto-fixable/)).toBeInTheDocument();
  });

  /* Story: an unrepairable mod whose worst finding is a warning is a mod that
     loads and plays. Sending that reader after an updated version is the errand
     the flat "no repair reaches it" header used to hand every one of them. */
  it("sends nobody looking when nothing stops a mod loading", () => {
    show({
      repairable: [],
      unrepairable: [verdict("b", "unrepairable", { severity: "warning" })],
    });

    expect(screen.getByText(/none of them stops a mod loading/)).toBeInTheDocument();
    expect(screen.queryByText(/look for updated versions/)).not.toBeInTheDocument();
  });

  it("names both errands when the list is mixed", () => {
    show({
      repairable: [verdict("a", "repairable")],
      unrepairable: [verdict("b", "unrepairable")],
    });

    expect(screen.getByText("Repairing is recommended")).toBeInTheDocument();
    expect(screen.getByText(/some will need updated versions instead/)).toBeInTheDocument();
  });

  /* The press cannot reach the rest, and the rest do not need reaching. */
  it("promises no updated versions for a mixed list the game still loads", () => {
    show({
      repairable: [verdict("a", "repairable")],
      unrepairable: [verdict("b", "unrepairable", { severity: "warning" })],
    });

    expect(screen.getByText("Repairing is recommended")).toBeInTheDocument();
    expect(screen.getByText(/what it misses will still load/)).toBeInTheDocument();
    expect(screen.queryByText(/updated versions/)).not.toBeInTheDocument();
  });

  /* A row counts every finding rather than the subset a repair can reach, and
     it counts them at the severity they were reported, because how bad is what
     a reader triages a flat list by. */
  it("names each mod and tallies what is wrong by severity", () => {
    show({ repairable: [verdict("a", "repairable", { fixable: 2, findings: 3 })] });

    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  /* The row's own repair is a second door to the one press, for a reader who
     wants one mod back rather than the library. */
  it("repairs a single mod from its own row", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    await user.click(screen.getByRole("button", { name: "Repair Charizard Smolder" }));

    expect(repairOne).toHaveBeenCalledWith("a");
  });

  /* Nothing can repair it, so the row offers no button that would fail. */
  it("gives an unrepairable row no repair of its own", () => {
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable")] });

    expect(screen.queryByRole("button", { name: /^Repair / })).not.toBeInTheDocument();
  });

  /* A missing Repair button is not a message, and there is no longer a group
     header to say the word once. The row answers in the seat the press would
     have been in, which is where a reader looks for it. */
  it("says in the press's own seat why an unrepairable row has none", () => {
    show({ unrepairable: [verdict("b", "unrepairable", { findings: 4 })] });

    expect(screen.getByText("Old Ashe Rework")).toBeInTheDocument();
    expect(screen.getByText("Needs an updated version")).toBeInTheDocument();
  });

  /* The seat says what the press would not have done. Only the mod the game
     refuses is sent after a replacement. */
  it("says only that a warning row is not auto-fixable", () => {
    show({ unrepairable: [verdict("b", "unrepairable", { findings: 4, severity: "warning" })] });

    expect(screen.getByText("Not auto-fixable")).toBeInTheDocument();
    expect(screen.queryByText("Needs an updated version")).not.toBeInTheDocument();
  });

  /* `3 problems` says how much and nothing else. The name is the disclosure,
     and the fold lists the rules behind the count. */
  it("unfolds a row into the rules behind its count", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable", { findings: 3 })], unrepairable: [] });

    await user.click(screen.getByRole("button", { name: "Charizard Smolder" }));

    expect(screen.getByText("Outdated bin properties")).toBeInTheDocument();
    /* The type pair is the actual problem, and it stands in for the rule's
       own sentence. */
    expect(
      screen.getByText((_, node) => node?.textContent === "Expected File, found Hash"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("A bin property's type does not match what the game expects"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("bin-property-type")).toBeInTheDocument();
    /* The fixture's brief fixes 2 of 3, and the words beside the count are
       what separate it from the identical rule on an unrepairable mod. */
    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(screen.getByText("1 not auto-fixable")).toBeInTheDocument();
    /* The why-not is not a line. Drawn under the cause it read as the panel
       saying one thing twice, so those words hold it instead. */
    expect(
      screen.queryByText("Couldn't rehash because source string is unknown"),
    ).not.toBeInTheDocument();
  });

  /* Story: the count is a count, whatever a repair can reach. What the press
     will miss is said in the words the list already uses for it, so a partial
     line and a hopeless one read the same way and differ by a number. */
  it("says how many of a rule's findings the repair will miss", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable", { findings: 3 })], unrepairable: [] });

    await user.click(screen.getByRole("button", { name: "Charizard Smolder" }));

    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(screen.queryByText("(2 of 3)")).not.toBeInTheDocument();

    await user.hover(screen.getByText("1 not auto-fixable"));
    expect(
      await screen.findByText("Couldn't rehash because source string is unknown"),
    ).toBeInTheDocument();
  });

  it("shows a plain count on a rule no repair reaches", async () => {
    const user = userEvent.setup();
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable", { findings: 4 })] });

    await user.click(screen.getByRole("button", { name: "Old Ashe Rework" }));

    expect(screen.getByText("(4)")).toBeInTheDocument();
    expect(screen.queryByText(/of 4/)).not.toBeInTheDocument();
  });

  /* A verdict recorded before briefs existed carries none, and a disclosure
     that opens onto nothing is a broken promise. */
  it("gives a verdict with no briefs a plain row", () => {
    show({ repairable: [verdict("a", "repairable", { rules: [] })], unrepairable: [] });

    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Charizard Smolder" })).not.toBeInTheDocument();
  });

  /* The footer press repairs what is enabled, so the rows have to show which
     ones those are. */
  it("marks the enabled rows and only those", () => {
    useInstalledMods.mockReturnValue({
      data: [installedMod("a", "Charizard Smolder"), installedMod("b", "Old Ashe Rework", false)],
    });
    show({
      repairable: [verdict("a", "repairable")],
      unrepairable: [verdict("b", "unrepairable")],
    });

    expect(screen.getAllByLabelText("Enabled")).toHaveLength(1);
  });

  /* The press repairs the enabled mods, so those lead the list, and the mod
     most is wrong with leads its half. */
  it("leads with the enabled mods, worst first", () => {
    useInstalledMods.mockReturnValue({
      data: [
        installedMod("a", "Alpha", false),
        installedMod("b", "Beta"),
        installedMod("c", "Gamma"),
      ],
    });
    show({
      repairable: [
        verdict("a", "repairable", { findings: 9 }),
        verdict("b", "repairable", { findings: 2 }),
        verdict("c", "repairable", { findings: 5 }),
      ],
      unrepairable: [],
    });

    const names = screen.getAllByText(/^(Alpha|Beta|Gamma)$/).map((el) => el.textContent);
    expect(names).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("falls back to the mod id when the library no longer names it", () => {
    useInstalledMods.mockReturnValue({ data: [] });
    show({ repairable: [verdict("ghost-id", "repairable")], unrepairable: [] });

    expect(screen.getByText("ghost-id")).toBeInTheDocument();
  });

  /* Two ways out, as every other dialog in the app offers: the corner mark and
     the footer press beside the repair. */
  it("closes from the header and from the footer", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    const [header, footer] = screen.getAllByRole("button", { name: "Close" });
    await user.click(header);
    await user.click(footer);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /* Nothing here can be repaired, and without a press of its own the footer
     went with it - leaving a dialog whose only answer was the corner mark. */
  it("gives a library no repair can reach a footer of its own", async () => {
    const user = userEvent.setup();
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable")] });

    const [, footer] = screen.getAllByRole("button", { name: "Close" });
    await user.click(footer);

    expect(onClose).toHaveBeenCalledOnce();
  });

  /* The panel names the mods the run is working through, so a toast over the
     top of it would cover the list to report on it. */
  it("hosts the running repair where its own button was", () => {
    run.isRepairing = true;
    run.progress = { completed: 7, total: 18, inFlight: ["a"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing Charizard Smolder")).toBeInTheDocument();
    expect(screen.getByText("7 / 18")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Repair \d/ })).not.toBeInTheDocument();
  });

  /* A run reads several mods at once, and the row is one line wide. */
  it("names one of the mods in flight and counts the rest", () => {
    run.isRepairing = true;
    run.progress = { completed: 2, total: 18, inFlight: ["a", "b", "c"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing Charizard Smolder and 2 more")).toBeInTheDocument();
  });

  it("names the run itself while it is between mods", () => {
    run.isRepairing = true;
    run.progress = { completed: 18, total: 18, inFlight: [] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing your mods")).toBeInTheDocument();
  });

  it("names a mod the library has since dropped by its id", () => {
    run.isRepairing = true;
    run.progress = { completed: 1, total: 2, inFlight: ["ghost-id"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing ghost-id")).toBeInTheDocument();
  });

  /* Every broken mod is switched on, so the two presses would do the same thing
     and a caret would only ask the reader to find that out. */
  it("draws one plain press when nothing broken is switched off", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByRole("button", { name: /Repair 1 mod/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More repair options" })).not.toBeInTheDocument();
  });

  /* A disabled mod reaches no overlay, so the press offers the work the next
     game needs and the library stays behind the caret. */
  it("splits the press when a broken mod is switched off", async () => {
    const user = userEvent.setup();
    useInstalledMods.mockReturnValue({
      data: [
        installedMod("a", "Charizard Smolder"),
        { ...installedMod("b", "Old Ashe Rework"), enabled: false },
      ],
    });
    show({
      repairable: [verdict("a", "repairable"), verdict("b", "repairable")],
      unrepairable: [],
    });

    expect(screen.getByRole("button", { name: /Repair 1 enabled mod/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More repair options" }));
    await user.click(screen.getByRole("menuitem", { name: "Repair all 2" }));

    expect(run.repair).toHaveBeenCalledWith(["a", "b"]);
  });

  it("repairs only what is switched on from the press itself", async () => {
    const user = userEvent.setup();
    useInstalledMods.mockReturnValue({
      data: [
        installedMod("a", "Charizard Smolder"),
        { ...installedMod("b", "Old Ashe Rework"), enabled: false },
      ],
    });
    show({
      repairable: [verdict("a", "repairable"), verdict("b", "repairable")],
      unrepairable: [],
    });

    await user.click(screen.getByRole("button", { name: /Repair 1 enabled mod/ }));

    expect(run.repair).toHaveBeenCalledWith(["a"]);
  });

  /* Splitting here would lead with "Repair 0 enabled mods" - a dead press
     offered as the recommendation - and hide the only run that does anything
     behind a caret. */
  it("offers the whole library when nothing broken is switched on", async () => {
    const user = userEvent.setup();
    useInstalledMods.mockReturnValue({
      data: [
        { ...installedMod("a", "Charizard Smolder"), enabled: false },
        { ...installedMod("b", "Old Ashe Rework"), enabled: false },
      ],
    });
    show({
      repairable: [verdict("a", "repairable"), verdict("b", "repairable")],
      unrepairable: [],
    });

    expect(screen.queryByRole("button", { name: /enabled mod/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More repair options" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Repair all 2/ }));

    expect(run.repair).toHaveBeenCalledWith(["a", "b"]);
  });

  /* A repair over a whole library takes long enough that a reader may want it
     to stop, and the run is reported here, so this is where the stop belongs. */
  it("offers a stop while the repair runs", async () => {
    const user = userEvent.setup();
    run.progress = { completed: 3, total: 18, inFlight: ["a"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    await user.click(screen.getByRole("button", { name: "Stop the repair" }));

    expect(cancelRun).toHaveBeenCalledOnce();
  });

  it("offers no stop while nothing is running", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.queryByRole("button", { name: "Stop the repair" })).not.toBeInTheDocument();
  });
});
