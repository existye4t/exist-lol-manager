import { useEffect } from "react";

import { ShockedPoroDuotoneIcon, useToast } from "@/components";
import { useModHealthDrawerStore, useQueuedDialog } from "@/stores";

import { useModHealthStatus } from "../api";
import { alarmOver, announcementKey, HEADLINE, toneOf } from "./modHealthNotice";
import { ModHealthSweepDialog } from "./ModHealthSweepDialog";

/**
 * The mod health panel, mounted where it can cover the grid it reports on.
 *
 * Per "The status bar item and the drawer" in docs/ux/MOD_HEALTH.md. What opens
 * it is a status bar cell in the app shell, so the two meet at
 * `useModHealthDrawerStore` rather than through the page between them.
 *
 * The unprompted announcement is raised here rather than from that cell, because
 * here is the only place that knows the drawer would be seen.
 */
export function ModHealthSweep() {
  const status = useModHealthStatus();
  const open = useModHealthDrawerStore((s) => s.open);
  const openDrawer = useModHealthDrawerStore((s) => s.openDrawer);
  const takeAnnouncement = useModHealthDrawerStore((s) => s.takeAnnouncement);
  const announced = useModHealthDrawerStore((s) => s.announced);
  const close = useModHealthDrawerStore((s) => s.close);
  const focusModId = useModHealthDrawerStore((s) => s.focusModId);
  const setHosted = useModHealthDrawerStore((s) => s.setHosted);
  const toast = useToast();
  const showing = useQueuedDialog("mod-health", open);

  useEffect(() => {
    if (!status || !takeAnnouncement(announcementKey(status.all))) return;

    if (alarmOver(status.all) === "flagged") {
      toast.toast({
        type: "info",
        title: HEADLINE,
        description: "Some of your mods contain non-fatal issues which are not repairable",
        /* The drawer's own mark for this rung, so the line the reader is sent
           from and the panel they land on are the same finding. */
        icon: <ShockedPoroDuotoneIcon className={`h-5 w-5 ${toneOf("flagged").chip}`} />,
        timeout: 8000,
        action: { label: "Show me", onClick: openDrawer },
      });
      return;
    }

    openDrawer();
    // `announced` so a press that reopens the question is heard: the verdicts
    // it refreshed can come back identical, and `status` would not move.
  }, [status, announced, takeAnnouncement, openDrawer, toast]);

  // Unconditional: this is where a drawer can be mounted, which is what the
  // cell needs to know. Whether one is showing right now is `open`.
  useEffect(() => {
    setHosted(true);
    return () => setHosted(false);
  }, [setHosted]);

  /* A press about one mod is answered even where the library-wide surfaces have
     nothing to say, which is the whole of what `focusModId` is for. */
  if (!status && !focusModId) return null;

  return <ModHealthSweepDialog open={showing} onClose={close} />;
}
