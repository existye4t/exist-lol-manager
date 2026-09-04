import { CrosshairIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import {
  Button,
  LeagueIcon,
  PathField,
  type PathValidity,
  RadioGroup,
  SectionCard,
  Switch,
} from "@/components";
import type { LaunchMode, Settings } from "@/lib/tauri";
import { useAutoDetectLeaguePath, useValidateLeaguePath } from "@/modules/settings/api";

import { ExperimentalChip } from "./ExperimentalChip";
import { SettingGroup } from "./SettingGroup";
import { SettingRow } from "./SettingRow";

interface LeagueSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

const LAUNCH_MODES: {
  value: LaunchMode;
  title: string;
  description: string;
  badge?: ReactNode;
}[] = [
  {
    value: "classic",
    title: "Classic",
    description: "Play only starts the patcher. Start League however you normally do.",
  },
  {
    value: "modern",
    title: "Modern",
    description:
      "Play starts the patcher and then League. One button for the whole thing, driven through the Riot Client.",
    badge: <ExperimentalChip />,
  },
];

const INVALID_PATH_HINT = (
  <>
    Could not find League of Legends at this path. Make sure it points to the folder containing the{" "}
    <code className="rounded-sm bg-surface-700 px-1 font-mono">Game</code> directory.
  </>
);

const STOP_PATCHER_HINT =
  "The Riot Client tells the manager when your game ends, and the patcher stops with it. Leave " +
  "this off to play several games in a row on one patch.";

const HIDE_RIOT_CLIENT_HINT =
  "Only the window is hidden. League needs the Riot Client for the whole session, so it keeps " +
  "running in the system tray, and it stays there when you close League. Click the tray icon " +
  "whenever you want it back.";

/** A check that has not run, or failed to run, leaves the input unmarked. */
function pathValidity(valid: boolean | undefined): PathValidity | undefined {
  if (valid === undefined) return undefined;
  return valid ? "valid" : "invalid";
}

export function LeagueSection({ settings, onSave }: LeagueSectionProps) {
  const { data: pathIsValid } = useValidateLeaguePath(settings.leaguePath);
  const autoDetect = useAutoDetectLeaguePath();

  function selectPath(path: string) {
    onSave({ ...settings, leaguePath: path, firstRunComplete: true });
  }

  function handleAutoDetect() {
    autoDetect.mutate(undefined, {
      onSuccess: (path) => {
        if (path) selectPath(path);
      },
      onError: (error) => console.error("Failed to auto-detect:", error),
    });
  }

  return (
    <SectionCard title="League of Legends" icon={<LeagueIcon className="h-5 w-5" />}>
      <SettingGroup id="general.installation" title="Installation">
        <SettingRow
          kind="action"
          layout="stacked"
          setting="leaguePath"
          control={
            <PathField
              pick="directory"
              aria-label="Installation path"
              value={settings.leaguePath}
              onSelect={selectPath}
              placeholder="Not configured"
              dialogTitle="Select League of Legends Installation"
              validity={pathValidity(pathIsValid)}
              error={pathIsValid === false && INVALID_PATH_HINT}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  left={<CrosshairIcon weight="bold" className="h-4 w-4" />}
                  loading={autoDetect.isPending}
                  onClick={handleAutoDetect}
                  className="shrink-0"
                >
                  Auto-detect
                </Button>
              }
            />
          }
        />
      </SettingGroup>

      <SettingGroup id="general.launching" title="Launching">
        <SettingRow
          kind="action"
          layout="stacked"
          setting="launchMode"
          description="Whichever you pick, the other action stays on the button's menu."
          control={
            <RadioGroup.Root
              value={settings.launchMode}
              onValueChange={(value: unknown) =>
                onSave({ ...settings, launchMode: value as LaunchMode })
              }
            >
              <RadioGroup.Options>
                {LAUNCH_MODES.map((mode) => (
                  <RadioGroup.Card
                    key={mode.value}
                    value={mode.value}
                    title={mode.title}
                    description={mode.description}
                    badge={mode.badge}
                  />
                ))}
              </RadioGroup.Options>
            </RadioGroup.Root>
          }
        />

        <SettingRow
          setting="hideRiotClientOnLaunch"
          hint={HIDE_RIOT_CLIENT_HINT}
          control={
            <Switch
              checked={settings.hideRiotClientOnLaunch}
              onCheckedChange={(checked) =>
                onSave({ ...settings, hideRiotClientOnLaunch: checked })
              }
            />
          }
        />

        <SettingRow
          setting="stopPatcherOnSessionEnd"
          hint={STOP_PATCHER_HINT}
          control={
            <Switch
              checked={settings.stopPatcherOnSessionEnd}
              onCheckedChange={(checked) =>
                onSave({ ...settings, stopPatcherOnSessionEnd: checked })
              }
            />
          }
        />
      </SettingGroup>
    </SectionCard>
  );
}
