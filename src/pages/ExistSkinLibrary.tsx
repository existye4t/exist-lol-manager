import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  ProhibitIcon,
  SparkleIcon,
  StopIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { useToast } from "@/components";
import {
  api,
  type ExistDownloadTask,
  type ExistSkin,
  type ExistSkinUpdateInfo,
  type InstalledExistSkin,
  type InstalledMod,
  type RuneforgeMod,
} from "@/lib/tauri";
import {
  useGuardedStartPatcher,
  useOverlayProgress,
  usePatcherStatus,
  useStopPatcher,
} from "@/modules/patcher";
import {
  useRuneforgeCatalog,
  useRuneforgeChampions,
  useRuneforgeThumbnail,
} from "@/modules/runeforge/api";
import { usePatcherSessionStore } from "@/stores";
import { getAppErrorMessage } from "@/utils/errors";
import { formatBytes } from "@/utils/formatBytes";
type View = "library" | "featured" | "downloads" | "cache" | "custom" | "runeforge";
type Progress = {
  skinId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  etaSeconds: number | null;
  state: string;
};

interface ChampionSummary {
  name: string;
  nameEn: string;
  championId: string;
  skins: ExistSkin[];
  totalSkins: number;
  installedCount: number;
  appliedSkin: ExistSkin | null;
  baseSkin: ExistSkin;
}

const nameOf = (skin: ExistSkin) => skin.name.trim() || skin.nameEn.trim();

export function Artwork({
  skin,
  className = "h-40 w-full object-cover",
  aspect = "cover",
}: {
  skin: ExistSkin;
  className?: string;
  aspect?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-900 text-xs font-semibold tracking-widest text-surface-500 ${className}`}
      >
        EXIST
      </div>
    );
  }

  return (
    <img
      loading="lazy"
      src={skin.image}
      alt={nameOf(skin)}
      className={`${className} ${aspect === "contain" ? "object-contain" : "object-cover"}`}
      onError={(event) => {
        if (skin.imageFallback && event.currentTarget.src !== skin.imageFallback) {
          event.currentTarget.src = skin.imageFallback;
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

export function ExistSkinLibrary() {
  const [skins, setSkins] = useState<ExistSkin[]>([]);
  const [installed, setInstalled] = useState<InstalledExistSkin[]>([]);
  const [view, setView] = useState<View>("library");
  const [query, setQuery] = useState("");
  const [selectedChampionName, setSelectedChampionName] = useState<string | null>(null);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading Exist catalog…");
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [queue, setQueue] = useState<ExistDownloadTask[]>([]);
  const [localMods, setLocalMods] = useState<InstalledMod[]>([]);
  const [importing, setImporting] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Record<string, ExistSkinUpdateInfo>>({});
  const [updatingSkins, setUpdatingSkins] = useState<
    Record<string, { progress: number; status: string }>
  >({});
  const toast = useToast();

  // Patcher Integration
  const { data: patcherStatus } = usePatcherStatus();
  const overlayProgress = useOverlayProgress();
  const { start: startPatcher } = useGuardedStartPatcher();
  const stopPatcher = useStopPatcher();
  const stopping = usePatcherSessionStore((s) => s.stopping);

  const isPatcherRunning = patcherStatus?.running ?? false;
  const isPatcherBuilding = patcherStatus?.phase === "building";
  const isPatcherActive = isPatcherRunning || isPatcherBuilding || stopping;

  async function refreshInstalled() {
    const result = await api.getInstalledExistSkins();
    if (result.ok) setInstalled(result.value);
  }

  async function refreshQueue() {
    const result = await api.getExistDownloadQueue();
    if (result.ok) setQueue(result.value);
  }

  async function refreshLocalMods() {
    const result = await api.getInstalledMods();
    if (result.ok) setLocalMods(result.value);
  }

  async function refreshStatus() {
    const result = await api.getExistCatalogStatus();
    if (result.ok) {
      setStatusMessage(
        result.value.error
          ? `Error: ${result.value.error}`
          : `Catalog v${result.value.sourceVersion || "unknown"}`,
      );
    }
  }

  async function checkForUpdates() {
    const result = await api.getExistSkinsUpdateStatus();
    if (result.ok) {
      const updateMap: Record<string, ExistSkinUpdateInfo> = {};
      for (const info of result.value) {
        updateMap[info.skinId] = info;
      }
      setUpdateInfo(updateMap);
    }
  }

  async function handleUpdateSkin(skinId: string) {
    const info = updateInfo[skinId];
    if (!info || !info.updateAvailable) return;

    setUpdatingSkins((prev) => ({ ...prev, [skinId]: { progress: 0, status: "Preparing..." } }));

    try {
      setUpdatingSkins((prev) => ({
        ...prev,
        [skinId]: { progress: 10, status: "Downloading..." },
      }));

      const result = await api.updateExistSkin(skinId);
      if (result.ok) {
        setUpdatingSkins((prev) => ({
          ...prev,
          [skinId]: { progress: 90, status: "Installing..." },
        }));

        await refreshInstalled();
        await checkForUpdates();

        setUpdatingSkins((prev) => ({ ...prev, [skinId]: { progress: 100, status: "Updated" } }));

        toast.success(
          "Skin updated",
          `${info.remoteSize ? `v${info.remoteSize}` : "Updated successfully"}`,
        );
      } else {
        throw new Error(getAppErrorMessage(result.error) || "Update failed");
      }
    } catch (error) {
      setUpdatingSkins((prev) => ({
        ...prev,
        [skinId]: {
          progress: 0,
          status: `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      }));
      toast.error("Update failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      // Clear updating status after a delay
      setTimeout(() => {
        setUpdatingSkins((prev) => {
          const next = { ...prev };
          delete next[skinId];
          return next;
        });
      }, 5000);
    }
  }

  const handleSync = useCallback(async () => {
    await api.syncExistSkinCatalog();
    await refreshStatus();
    await checkForUpdates();
    void api.getExistCatalog().then((result) => {
      if (result.ok) {
        setSkins(result.value.skins);
        setStatusMessage(`Loaded ${result.value.skins.length} skins`);
      }
    });
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshInstalled();
    void handleSync();

    // Polling every 15 minutes
    const interval = setInterval(handleSync, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [handleSync]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("library-changed", () => {
      void refreshLocalMods();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<Progress>("exist-download-progress", (event) => {
      setProgress((prev) => ({ ...prev, [event.payload.skinId]: event.payload }));
      void refreshQueue();
      if (event.payload.state === "downloaded" || event.payload.state === "completed") {
        void refreshInstalled();
      }
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, []);

  const installedById = useMemo(
    () => new Map(installed.map((item) => [item.skinId, item])),
    [installed],
  );
  const appliedCount = useMemo(() => installed.filter((item) => item.applied).length, [installed]);

  // Group skins by Champion
  const champions = useMemo<ChampionSummary[]>(() => {
    const map = new Map<string, ExistSkin[]>();
    for (const skin of skins) {
      const champ = skin.champion.trim() || skin.championEn.trim() || "Unknown";
      const list = map.get(champ) ?? [];
      list.push(skin);
      map.set(champ, list);
    }

    const summaries: ChampionSummary[] = [];
    for (const [name, champSkins] of map.entries()) {
      champSkins.sort((a, b) => a.skinNum - b.skinNum);
      const baseSkin = champSkins.find((s) => s.skinNum === 0) ?? champSkins[0];
      const installedCount = champSkins.filter((s) => installedById.has(s.id)).length;
      const appliedSkin = champSkins.find((s) => installedById.get(s.id)?.applied) ?? null;

      summaries.push({
        name,
        nameEn: baseSkin?.championEn ?? name,
        championId: baseSkin?.championId ?? name,
        skins: champSkins,
        totalSkins: champSkins.length,
        installedCount,
        appliedSkin,
        baseSkin,
      });
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [skins, installedById]);

  const selectedChampion = useMemo(() => {
    if (!selectedChampionName) return null;
    return champions.find((c) => c.name === selectedChampionName) ?? null;
  }, [champions, selectedChampionName]);

  const selectedSkin = useMemo(() => {
    if (!selectedSkinId) return null;
    return skins.find((s) => s.id === selectedSkinId) ?? null;
  }, [skins, selectedSkinId]);

  // Search Filtering
  const filteredChampions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return champions;

    return champions.filter((champ) => {
      const champMatches = `${champ.name} ${champ.nameEn}`.toLocaleLowerCase("tr").includes(needle);
      if (champMatches) return true;

      // Check if any skin of this champion matches
      return champ.skins.some((skin) =>
        `${skin.name} ${skin.nameEn}`.toLocaleLowerCase("tr").includes(needle),
      );
    });
  }, [champions, query]);

  // Cached skins list
  const cachedItems = useMemo(() => {
    return installed.flatMap((entry) => {
      const skin = skins.find((item) => item.id === entry.skinId);
      return skin ? [{ skin, entry }] : [];
    });
  }, [installed, skins]);

  // Actions
  async function handleDownload(skin: ExistSkin) {
    const result = await api.enqueueExistDownload(skin.id);
    if (result.ok) {
      await refreshQueue();
    }
  }

  async function handleApply(skin: ExistSkin) {
    if (isPatcherActive) return;
    setBusy(skin.id);
    const result = await api.applyExistSkin(skin.id);
    setBusy(null);
    if (result.ok) {
      await refreshInstalled();
    }
  }

  async function handleUnapply(skin: ExistSkin) {
    if (isPatcherActive) return;
    setBusy(skin.id);
    const result = await api.unapplyExistSkin(skin.id);
    setBusy(null);
    if (result.ok) {
      await refreshInstalled();
      toast.success("Skin unapplied", `${nameOf(skin)} was unapplied.`);
    } else {
      toast.error("Could not unapply skin", getAppErrorMessage(result.error));
    }
  }

  async function handleDelete(skin: ExistSkin) {
    if (isPatcherActive) return;
    if (!window.confirm(`Delete ${nameOf(skin)} from Exist cache?`)) return;
    setBusy(skin.id);
    const result = await api.deleteExistSkin(skin.id);
    setBusy(null);
    if (result.ok) {
      await refreshInstalled();
      toast.success("Skin deleted", `${nameOf(skin)} was removed from cache.`);
    } else {
      toast.error("Could not delete skin", getAppErrorMessage(result.error));
    }
  }

  async function handleImportFantome() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Fantome Mod", extensions: ["fantome", "zip"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setImporting(true);
    const result = await api.installMod(selected);
    setImporting(false);
    if (!result.ok) {
      toast.error("Import failed", getAppErrorMessage(result.error));
      return;
    }
    setLocalMods((mods) => [result.value, ...mods.filter((mod) => mod.id !== result.value.id)]);
    toast.success("Skin imported", `${result.value.displayName} was added to your local library.`);
  }

  async function handleLocalToggle(mod: InstalledMod, enabled: boolean) {
    const result = await api.toggleMod(mod.id, enabled);
    if (result.ok) await refreshLocalMods();
    else toast.error("Could not update skin", getAppErrorMessage(result.error));
  }

  async function handleLocalUninstall(mod: InstalledMod) {
    const result = await api.uninstallMod(mod.id);
    if (result.ok) {
      setLocalMods((mods) => mods.filter((item) => item.id !== mod.id));
      toast.success("Skin removed", `${mod.displayName} was removed from your local library.`);
    } else toast.error("Could not remove skin", getAppErrorMessage(result.error));
  }

  function openChampion(champName: string, skinId?: string) {
    setSelectedChampionName(champName);
    setSelectedSkinId(skinId ?? null);
  }

  function closeDrawer() {
    setSelectedChampionName(null);
    setSelectedSkinId(null);
  }

  const activeDownloadCount = queue.filter(
    (t) => !["completed", "failed", "cancelled"].includes(t.state),
  ).length;
  const enabledModCount = localMods.filter((mod) => mod.enabled).length;

  return (
    <div className="flex h-full min-h-0 bg-surface-950 font-sans text-surface-100 select-none">
      {/* Sidebar Navigation */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-surface-800 bg-surface-900/90 p-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-md shadow-accent-500/20">
            <SparkleIcon weight="fill" className="h-5 w-5 text-on-accent" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-white">EXIST</h1>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-accent-400">
              SKIN MANAGER
            </p>
          </div>
        </div>

        {/* Global Patcher Status Indicator */}
        <div className="mt-6 rounded-xl border border-surface-800 bg-surface-950/60 p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-surface-400">Patcher Status</span>
            {isPatcherRunning ? (
              <span className="flex items-center gap-1.5 font-semibold text-success-text">
                <span className="h-2 w-2 animate-pulse rounded-full bg-success shadow-[0_0_8px] shadow-success" />
                Running
              </span>
            ) : isPatcherBuilding ? (
              <span className="flex items-center gap-1.5 font-semibold text-accent-400">
                <CircleNotchIcon className="h-3.5 w-3.5 animate-spin text-accent-500" />
                Building
              </span>
            ) : stopping ? (
              <span className="text-surface-400">Stopping…</span>
            ) : (
              <span className="flex items-center gap-1.5 text-surface-400">
                <span className="h-2 w-2 rounded-full border border-surface-600" />
                Ready
              </span>
            )}
          </div>

          <div className="mt-3">
            {isPatcherRunning ? (
              <button
                disabled={stopping}
                onClick={() => stopPatcher.mutate()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-danger/40 bg-danger/10 py-2 text-xs font-semibold text-danger-text transition-colors hover:bg-danger/20"
              >
                <StopIcon weight="bold" className="h-3.5 w-3.5" />
                {stopping ? "Stopping…" : "Stop Patcher"}
              </button>
            ) : (
              <button
                disabled={isPatcherBuilding || enabledModCount === 0}
                onClick={() => void startPatcher({})}
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold shadow-sm transition-all ${
                  enabledModCount > 0
                    ? "cursor-pointer bg-accent-500 text-on-accent shadow-accent-500/25 hover:bg-accent-400"
                    : "cursor-not-allowed bg-surface-800 text-surface-500"
                }`}
              >
                {isPatcherBuilding ? (
                  <>
                    <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" />
                    Building Overlay…
                  </>
                ) : (
                  <>
                    <PlayIcon weight="bold" className="h-3.5 w-3.5" />
                    START PATCHER {enabledModCount > 0 && `(${enabledModCount})`}
                  </>
                )}
              </button>
            )}
          </div>
          {enabledModCount === 0 && !isPatcherActive && (
            <p className="mt-2 text-[11px] leading-tight text-surface-500">
              Enable a skin to start the patcher
            </p>
          )}
        </div>

        {/* Navigation List */}
        <nav className="mt-6 space-y-1.5">
          <button
            onClick={() => setView("library")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "library"
                ? "bg-accent-500 font-semibold text-on-accent"
                : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Champions</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${view === "library" ? "bg-black/20 text-on-accent" : "bg-surface-800 text-surface-400"}`}
            >
              {champions.length}
            </span>
          </button>

          <button
            onClick={() => setView("featured")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "featured"
                ? "bg-accent-500 font-semibold text-on-accent"
                : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Featured Skins</span>
            <SparkleIcon className="h-4 w-4 opacity-70" />
          </button>

          <button
            onClick={() => setView("downloads")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "downloads"
                ? "bg-accent-500 font-semibold text-on-accent"
                : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Downloads</span>
            {activeDownloadCount > 0 && (
              <span className="flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-accent-500 text-[11px] font-bold text-on-accent">
                {activeDownloadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setView("cache")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "cache"
                ? "bg-accent-500 font-semibold text-on-accent"
                : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Installed & Cache</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${view === "cache" ? "bg-black/20 text-on-accent" : "bg-surface-800 text-surface-400"}`}
            >
              {installed.length}
            </span>
          </button>
          <button
            onClick={() => setView("custom")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "custom"
                ? "bg-accent-500 font-semibold text-on-accent"
                : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Custom Skins</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${view === "custom" ? "bg-black/20 text-on-accent" : "bg-surface-800 text-surface-400"}`}
            >
              {localMods.length}
            </span>
          </button>
          <button
            onClick={() => setView("runeforge")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "runeforge"
                ? "bg-accent-500 font-semibold text-on-accent"
                : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>RuneForge</span>
            <span className="text-[10px] font-bold tracking-wide opacity-75">PUBLIC</span>
          </button>
        </nav>

        {/* Footer State Info */}
        <div className="mt-auto flex flex-col gap-1 border-t border-surface-800/60 pt-4 text-xs text-surface-500">
          <div className="flex items-center justify-between">
            <span>Applied skins:</span>
            <span className="font-semibold text-accent-400">{appliedCount}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-surface-500">{statusMessage}</p>

          {/* Discord Button */}
          <div className="mt-4 border-t border-surface-800/60 pt-4">
            <a
              href="https://discord.gg/VFYj8yefn"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent-500/20 bg-accent-500/10 px-3 py-2.5 text-sm font-medium text-accent-400 transition-all hover:border-accent-500/40 hover:bg-accent-500/20"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
              <span>Join Discord</span>
            </a>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top App Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-surface-800 bg-surface-950/80 px-8 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white">
              {view === "library" && "Champion Library"}
              {view === "featured" && "Featured Skins"}
              {view === "downloads" && "Downloads & Queue"}
              {view === "cache" && "Installed Cache"}
              {view === "custom" && "Custom Skins"}
              {view === "runeforge" && "RuneForge"}
            </h2>
            {view === "library" && (
              <span className="rounded-full bg-surface-800 px-2.5 py-0.5 text-xs text-surface-400">
                {filteredChampions.length} champions
              </span>
            )}
          </div>

          {/* Search Bar */}
          <div className="relative w-80">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-surface-400"
              size={16}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search champions or skins…"
              className="w-full rounded-full border border-surface-700 bg-surface-900/90 py-2 pr-8 pl-9 text-xs text-white placeholder-surface-500 transition-all outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-surface-400 hover:text-white"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        </header>

        {/* Patcher Lock Banner */}
        {isPatcherActive && (
          <div className="flex items-center justify-between border-b border-accent-500/30 bg-accent-500/10 px-8 py-2 text-xs text-accent-300">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 animate-ping rounded-full bg-accent-400" />
              Patcher is currently active. Skin modification is locked until patching finishes or
              stops.
            </span>
            <span className="font-mono text-[11px] opacity-75">
              {overlayProgress ? `${overlayProgress.stage}` : "Injecting mods"}
            </span>
          </div>
        )}

        {/* Main Viewport Container */}
        <main className="flex-1 overflow-y-auto p-8">
          {view === "library" && (
            <ChampionGrid
              champions={filteredChampions}
              selectedChampion={selectedChampion}
              onSelectChampion={(champ) => openChampion(champ.name)}
            />
          )}

          {view === "featured" && (
            <FeaturedGrid
              skins={skins
                .filter((s) => s.hasFantome)
                .sort((a, b) => a.id.localeCompare(b.id))
                .slice(0, 16)}
              installedById={installedById}
              busy={busy}
              isPatcherActive={isPatcherActive}
              onSelectSkin={(skin) => openChampion(skin.champion, skin.id)}
              onDownload={handleDownload}
              onApply={handleApply}
              onUnapply={handleUnapply}
            />
          )}

          {view === "cache" && (
            <>
              <CacheView
                items={cachedItems}
                busy={busy}
                isPatcherActive={isPatcherActive}
                onApply={handleApply}
                onUnapply={handleUnapply}
                onDelete={handleDelete}
                onInspect={(skin) => openChampion(skin.champion, skin.id)}
                onBrowse={() => setView("library")}
                updateInfo={updateInfo}
                updatingSkins={updatingSkins}
                checkForUpdates={checkForUpdates}
                handleUpdateSkin={handleUpdateSkin}
              />
            </>
          )}

          {view === "custom" && (
            <CustomSkinsView
              mods={localMods}
              importing={importing}
              isPatcherActive={isPatcherActive}
              onImport={handleImportFantome}
              onToggle={handleLocalToggle}
              onUninstall={handleLocalUninstall}
            />
          )}

          {view === "runeforge" && <RuneForgeView />}

          {view === "downloads" && (
            <DownloadsView
              progress={progress}
              skins={skins}
              queue={queue}
              refreshQueue={refreshQueue}
            />
          )}
        </main>

        {/* Side Panel Drawer for Champion & Skin Detail */}
        {selectedChampion && (
          <SideDetailDrawer
            champion={selectedChampion}
            selectedSkin={selectedSkin}
            allSkins={skins}
            installedById={installedById}
            progress={progress}
            queue={queue}
            busy={busy}
            isPatcherActive={isPatcherActive}
            onClose={closeDrawer}
            onSelectSkin={(skin) => setSelectedSkinId(skin.id)}
            onBackToSkins={() => setSelectedSkinId(null)}
            onDownload={handleDownload}
            onApply={handleApply}
            onUnapply={handleUnapply}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 1. CHAMPION-FIRST GRID                                                   */
/* ========================================================================= */

function ChampionGrid({
  champions,
  selectedChampion,
  onSelectChampion,
}: {
  champions: ChampionSummary[];
  selectedChampion: ChampionSummary | null;
  onSelectChampion: (champ: ChampionSummary) => void;
}) {
  if (champions.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <ProhibitIcon size={40} className="mb-3 text-surface-600" />
        <h3 className="font-display text-lg text-white">No champions found</h3>
        <p className="mt-1 text-xs text-surface-400">Try refining your search query.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4 pb-12">
      {champions.map((champ) => {
        const isSelected = selectedChampion?.name === champ.name;
        const hasApplied = !!champ.appliedSkin;

        return (
          <button
            key={champ.name}
            onClick={() => onSelectChampion(champ)}
            className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 ${
              isSelected
                ? "bg-surface-850 scale-[1.02] border-accent-500 shadow-lg shadow-accent-500/10"
                : hasApplied
                  ? "border-success/40 bg-surface-900/90 hover:scale-[1.01] hover:border-success/70"
                  : "border-surface-800 bg-surface-900/80 hover:scale-[1.01] hover:border-surface-600"
            }`}
          >
            {/* Splash Artwork */}
            <div className="relative h-36 w-full overflow-hidden bg-surface-950">
              <Artwork
                skin={champ.baseSkin}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/30 to-transparent" />

              {/* Status Badges on Artwork */}
              <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1">
                {hasApplied && (
                  <span className="flex items-center gap-1 rounded-full bg-success/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-success/40">
                    <CheckCircleIcon weight="fill" className="h-3 w-3" />
                    Applied
                  </span>
                )}
                {champ.installedCount > 0 && !hasApplied && (
                  <span className="rounded-full border border-surface-700 bg-surface-900/80 px-2 py-0.5 text-[10px] font-medium text-surface-300">
                    {champ.installedCount} cached
                  </span>
                )}
              </div>
            </div>

            {/* Champion Info */}
            <div className="flex flex-1 flex-col justify-between p-4">
              <div>
                <h3 className="font-display text-base font-bold text-white transition-colors group-hover:text-accent-300">
                  {champ.name}
                </h3>
                {champ.nameEn !== champ.name && (
                  <p className="truncate text-[11px] text-surface-500">{champ.nameEn}</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-surface-800/80 pt-2.5 text-xs text-surface-400">
                <span>{champ.totalSkins} skins</span>
                <span className="flex items-center gap-1 text-[11px] text-accent-400 transition-transform group-hover:translate-x-0.5">
                  View skins <CaretRightIcon size={12} weight="bold" />
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ========================================================================= */
/* 2. SIDE DETAIL PANEL / DRAWER                                            */
/* ========================================================================= */

function SideDetailDrawer({
  champion,
  selectedSkin,
  allSkins,
  installedById,
  progress,
  queue,
  busy,
  isPatcherActive,
  onClose,
  onSelectSkin,
  onBackToSkins,
  onDownload,
  onApply,
  onUnapply,
  onDelete,
}: {
  champion: ChampionSummary;
  selectedSkin: ExistSkin | null;
  allSkins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  progress: Record<string, Progress>;
  queue: ExistDownloadTask[];
  busy: string | null;
  isPatcherActive: boolean;
  onClose: () => void;
  onSelectSkin: (skin: ExistSkin) => void;
  onBackToSkins: () => void;
  onDownload: (skin: ExistSkin) => Promise<void>;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
  onDelete: (skin: ExistSkin) => Promise<void>;
}) {
  return (
    <div className="animate-in slide-in-from-right absolute inset-y-0 right-0 z-30 flex w-[480px] max-w-[90vw] flex-col border-l border-surface-800 bg-surface-900 shadow-2xl backdrop-blur-xl duration-200">
      {/* Drawer Header */}
      <div className="relative h-44 shrink-0 overflow-hidden bg-surface-950">
        <Artwork
          skin={selectedSkin ?? champion.baseSkin}
          className="h-full w-full object-cover brightness-75"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/60 to-transparent" />

        {/* Top Controls */}
        <div className="absolute top-3 right-4 left-4 flex items-center justify-between">
          {selectedSkin ? (
            <button
              onClick={onBackToSkins}
              className="flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900/80 px-3 py-1 text-xs font-semibold text-surface-200 transition-colors hover:bg-surface-800"
            >
              <ArrowLeftIcon size={12} weight="bold" />
              All {champion.name} Skins
            </button>
          ) : (
            <span className="rounded-full border border-surface-700 bg-surface-900/80 px-2.5 py-0.5 text-[11px] font-semibold text-surface-300">
              {champion.totalSkins} skins available
            </span>
          )}

          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-700 bg-surface-900/80 text-surface-300 transition-colors hover:bg-surface-800 hover:text-white"
            aria-label="Close"
          >
            <XIcon size={14} weight="bold" />
          </button>
        </div>

        {/* Header Title Info */}
        <div className="absolute right-5 bottom-3 left-5">
          <p className="text-[11px] font-semibold tracking-widest text-accent-400 uppercase">
            {champion.name}
          </p>
          <h2 className="truncate font-display text-2xl font-bold text-white">
            {selectedSkin ? nameOf(selectedSkin) : champion.name}
          </h2>
          {selectedSkin && selectedSkin.parentSkinId && (
            <p className="text-[11px] text-surface-400">Chroma variant</p>
          )}
        </div>
      </div>

      {/* Drawer Body: Switch between Skin Detail & Champion Skin Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {selectedSkin ? (
          <SkinDetailContent
            skin={selectedSkin}
            allSkins={allSkins}
            installedById={installedById}
            progress={progress}
            queue={queue}
            busy={busy}
            isPatcherActive={isPatcherActive}
            onSelectSkin={onSelectSkin}
            onDownload={onDownload}
            onApply={onApply}
            onUnapply={onUnapply}
            onDelete={onDelete}
          />
        ) : (
          <ChampionSkinsList
            skins={champion.skins}
            installedById={installedById}
            progress={progress}
            queue={queue}
            onSelectSkin={onSelectSkin}
          />
        )}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 3. CHAMPION SKINS LIST (Inside Drawer)                                   */
/* ========================================================================= */

function ChampionSkinsList({
  skins,
  installedById,
  progress,
  queue,
  onSelectSkin,
}: {
  skins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  progress: Record<string, Progress>;
  queue: ExistDownloadTask[];
  onSelectSkin: (skin: ExistSkin) => void;
}) {
  const baseSkins = skins.filter((s) => !s.parentSkinId);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSkins = useMemo(() => {
    if (!searchQuery.trim()) return baseSkins;
    const query = searchQuery.trim().toLocaleLowerCase();
    return baseSkins.filter((skin) =>
      `${skin.name} ${skin.nameEn}`.toLocaleLowerCase().includes(query),
    );
  }, [baseSkins, searchQuery]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-surface-800 pb-2 text-xs text-surface-400">
        <span>Select a skin to download or apply</span>
        <span>{filteredSkins.length} items</span>
      </div>

      {/* Champion-local search */}
      <div className="mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search skins in this champion…"
          className="w-full rounded-lg border border-surface-700 bg-surface-900/90 px-3 py-2 text-xs text-white placeholder-surface-500 transition-all outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="mt-1 text-xs text-surface-500 hover:text-surface-300"
          >
            Clear search
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {filteredSkins.map((skin) => {
          const entry = installedById.get(skin.id);
          const task = queue.find((q) => q.skinId === skin.id);
          const prog = progress[skin.id];
          const isDownloading = task?.state === "downloading";
          const percent = prog?.totalBytes
            ? Math.round((prog.downloadedBytes / prog.totalBytes) * 100)
            : 0;

          return (
            <button
              key={skin.id}
              onClick={() => onSelectSkin(skin)}
              className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 ${
                entry?.applied
                  ? "border-success/50 bg-success/5 hover:border-success"
                  : entry
                    ? "bg-surface-850 border-surface-700 hover:border-surface-500"
                    : "hover:bg-surface-850 border-surface-800 bg-surface-900/60 hover:border-surface-600"
              }`}
            >
              {/* Artwork */}
              <div className="relative h-24 w-full overflow-hidden bg-surface-950">
                <Artwork
                  skin={skin}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-transparent to-transparent" />

                {/* Status Badges */}
                <div className="absolute top-1.5 right-1.5">
                  {entry?.applied ? (
                    <span className="rounded-full bg-success px-1.5 py-0.5 text-[9px] font-bold text-white shadow-xs">
                      Applied
                    </span>
                  ) : entry ? (
                    <span className="rounded-full border border-surface-700 bg-surface-900/80 px-1.5 py-0.5 text-[9px] font-medium text-surface-300">
                      Installed
                    </span>
                  ) : isDownloading ? (
                    <span className="animate-pulse rounded-full bg-accent-500 px-1.5 py-0.5 text-[9px] font-bold text-on-accent">
                      {percent}%
                    </span>
                  ) : !skin.hasFantome ? (
                    <span className="rounded-full bg-surface-950/80 px-1.5 py-0.5 text-[9px] text-surface-500">
                      No pkg
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Skin Info */}
              <div className="p-2.5">
                <h4 className="truncate text-xs font-semibold text-white transition-colors group-hover:text-accent-300">
                  {nameOf(skin)}
                </h4>
                <p className="mt-0.5 truncate text-[10px] text-surface-500">ID {skin.id}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 4. SKIN DETAIL CONTENT (Inside Drawer)                                   */
/* ========================================================================= */

function SkinDetailContent({
  skin,
  allSkins,
  installedById,
  progress,
  queue,
  busy,
  isPatcherActive,
  onSelectSkin,
  onDownload,
  onApply,
  onUnapply,
  onDelete,
}: {
  skin: ExistSkin;
  allSkins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  progress: Record<string, Progress>;
  queue: ExistDownloadTask[];
  busy: string | null;
  isPatcherActive: boolean;
  onSelectSkin: (skin: ExistSkin) => void;
  onDownload: (skin: ExistSkin) => Promise<void>;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
  onDelete: (skin: ExistSkin) => Promise<void>;
}) {
  const entry = installedById.get(skin.id);
  const task = queue.find((q) => q.skinId === skin.id);
  const prog = progress[skin.id] ?? task;

  const isDownloading =
    task?.state === "downloading" || task?.state === "queued" || task?.state === "pausing";
  const isPaused = task?.state === "paused";
  const isFailed = task?.state === "failed" || task?.state === "cancelled";
  const percent = prog?.totalBytes ? Math.round((prog.downloadedBytes / prog.totalBytes) * 100) : 0;

  // Sibling chromas
  const chromas = useMemo(() => {
    const parentId = skin.parentSkinId ?? skin.id;
    return allSkins.filter(
      (s) => s.parentSkinId === parentId || (s.id === parentId && s.id !== skin.id),
    );
  }, [allSkins, skin]);

  const parentSkin = useMemo(() => {
    if (!skin.parentSkinId) return null;
    return allSkins.find((s) => s.id === skin.parentSkinId) ?? null;
  }, [allSkins, skin]);

  return (
    <div className="space-y-6">
      {/* Overview Metadata */}
      <div className="rounded-xl border border-surface-800 bg-surface-950/60 p-4">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-surface-500">Skin Number</span>
            <span className="font-semibold text-white">#{skin.skinNum}</span>
          </div>
          <div>
            <span className="block text-surface-500">Package ID</span>
            <span className="font-mono text-white">{skin.id}</span>
          </div>
          <div>
            <span className="block text-surface-500">Fantome Source</span>
            <span
              className={skin.hasFantome ? "font-semibold text-success-text" : "text-surface-400"}
            >
              {skin.hasFantome ? "Available" : "Unavailable"}
            </span>
          </div>
          <div>
            <span className="block text-surface-500">Status</span>
            <span className="font-semibold text-white">
              {entry?.applied
                ? "Applied"
                : entry
                  ? "Installed"
                  : isDownloading
                    ? "Downloading"
                    : "Not installed"}
            </span>
          </div>
        </div>
      </div>

      {/* Download / Progress Bar Section */}
      {isDownloading && (
        <div className="space-y-3 rounded-xl border border-accent-500/30 bg-accent-500/5 p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-accent-400">
              {task?.state === "downloading" ? "Downloading Fantome archive…" : task?.state}
            </span>
            <span className="font-mono text-surface-300">{percent}%</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-800">
            <div
              className="h-full bg-accent-500 transition-all duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="flex items-center justify-between font-mono text-[11px] text-surface-400">
            <span>
              {formatBytes(prog?.downloadedBytes ?? 0)}
              {prog?.totalBytes ? ` / ${formatBytes(prog.totalBytes)}` : ""}
            </span>
            {prog?.bytesPerSecond ? <span>{formatBytes(prog.bytesPerSecond)}/s</span> : null}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => void api.pauseExistDownload(skin.id)}
              className="flex-1 rounded-lg border border-surface-700 bg-surface-800 py-1.5 text-xs font-semibold text-surface-300 hover:bg-surface-700"
            >
              Pause
            </button>
            <button
              onClick={() => void api.cancelExistDownload(skin.id)}
              className="flex-1 rounded-lg border border-surface-700 bg-surface-800 py-1.5 text-xs font-semibold text-surface-300 hover:bg-surface-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Paused State */}
      {isPaused && (
        <div className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/5 p-4 text-xs">
          <span className="font-medium text-warning-text">Download paused</span>
          <div className="flex gap-2">
            <button
              onClick={() => void api.resumeExistDownload(skin.id)}
              className="rounded-lg bg-accent-500 px-3 py-1 text-xs font-semibold text-on-accent hover:bg-accent-400"
            >
              Resume
            </button>
            <button
              onClick={() => void api.cancelExistDownload(skin.id)}
              className="rounded-lg border border-surface-700 px-3 py-1 text-xs font-medium text-surface-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Failed State */}
      {isFailed && (
        <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-4 text-xs">
          <p className="font-semibold text-danger-text">Download failed</p>
          {task?.error && <p className="text-[11px] text-surface-400">{task.error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => void api.retryExistDownload(skin.id)}
              className="rounded-lg bg-accent-500 px-3 py-1 text-xs font-semibold text-on-accent hover:bg-accent-400"
            >
              Retry
            </button>
            <button
              onClick={() => void api.removeExistDownload(skin.id)}
              className="rounded-lg border border-surface-700 px-3 py-1 text-xs font-medium text-surface-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Primary Action Buttons */}
      <div className="space-y-2.5">
        {entry?.applied ? (
          <button
            disabled={isPatcherActive || busy === skin.id}
            onClick={() => void onUnapply(skin)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-success/50 bg-success/20 py-3 text-sm font-bold text-success-text shadow-md shadow-success/10 transition-all hover:bg-success/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircleIcon weight="fill" className="h-4 w-4" />
            {busy === skin.id ? "Unapplying…" : "UNAPPLY SKIN"}
          </button>
        ) : entry ? (
          <button
            disabled={isPatcherActive || busy === skin.id}
            onClick={() => void onApply(skin)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 text-sm font-bold text-on-accent shadow-lg shadow-accent-500/20 transition-all hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === skin.id ? (
              <>
                <CircleNotchIcon className="h-4 w-4 animate-spin" />
                Applying…
              </>
            ) : (
              "APPLY SKIN"
            )}
          </button>
        ) : skin.hasFantome && !isDownloading ? (
          <button
            onClick={() => void onDownload(skin)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 text-sm font-bold text-on-accent shadow-lg shadow-accent-500/20 transition-all hover:bg-accent-400"
          >
            <DownloadSimpleIcon weight="bold" className="h-4 w-4" />
            DOWNLOAD FANTOME
          </button>
        ) : !skin.hasFantome ? (
          <div className="rounded-xl border border-surface-800 bg-surface-950/40 p-3 text-center text-xs text-surface-500">
            No Fantome archive indexed for this skin
          </div>
        ) : null}

        {/* Delete Action if installed */}
        {entry && (
          <button
            disabled={isPatcherActive || busy === skin.id}
            onClick={() => void onDelete(skin)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-surface-800 bg-surface-950/40 py-2 text-xs font-semibold text-surface-400 transition-colors hover:border-danger/40 hover:bg-danger/5 hover:text-danger-text disabled:opacity-50"
          >
            <TrashIcon size={14} />
            Delete from Cache
          </button>
        )}
      </div>

      {/* Chroma Relationships */}
      {parentSkin && (
        <div className="border-t border-surface-800 pt-4">
          <span className="mb-2 block text-xs font-semibold text-surface-400">Base Skin</span>
          <button
            onClick={() => onSelectSkin(parentSkin)}
            className="flex w-full items-center gap-3 rounded-xl border border-surface-800 bg-surface-950/50 p-2.5 text-left transition-colors hover:border-surface-600"
          >
            <Artwork skin={parentSkin} className="h-10 w-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{nameOf(parentSkin)}</p>
              <p className="text-[11px] text-surface-500">Parent Skin</p>
            </div>
            <CaretRightIcon size={14} className="text-surface-500" />
          </button>
        </div>
      )}

      {chromas.length > 0 && (
        <div className="border-t border-surface-800 pt-4">
          <span className="mb-2 block text-xs font-semibold text-surface-400">
            Chromas & Variants ({chromas.length})
          </span>
          <div className="grid grid-cols-2 gap-2">
            {chromas.map((chroma) => (
              <button
                key={chroma.id}
                onClick={() => onSelectSkin(chroma)}
                className="flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-950/50 p-2 text-left transition-colors hover:border-surface-600"
              >
                <Artwork skin={chroma} className="h-8 w-10 rounded object-cover" />
                <span className="truncate text-[11px] font-medium text-surface-300">
                  {nameOf(chroma)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= */
/* 5. CACHE / INSTALLED VIEW                                                */
/* ========================================================================= */

function CacheView({
  items,
  busy,
  isPatcherActive,
  onApply,
  onUnapply,
  onDelete,
  onInspect,
  onBrowse,
  updateInfo,
  updatingSkins,
  checkForUpdates,
  handleUpdateSkin,
}: {
  items: { skin: ExistSkin; entry: InstalledExistSkin }[];
  busy: string | null;
  isPatcherActive: boolean;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
  onDelete: (skin: ExistSkin) => Promise<void>;
  onInspect: (skin: ExistSkin) => void;
  onBrowse: () => void;
  updateInfo: Record<string, ExistSkinUpdateInfo>;
  updatingSkins: Record<string, { progress: number; status: string }>;
  checkForUpdates: () => Promise<void>;
  handleUpdateSkin: (skinId: string) => void;
}) {
  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.entry.fileSize), 0),
    [items],
  );

  if (items.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center text-center">
        <div className="max-w-md rounded-2xl border border-surface-800 bg-surface-900 p-8 shadow-xl">
          <h3 className="font-display text-2xl font-bold text-white">No cached skins</h3>
          <p className="mt-2 text-xs leading-relaxed text-surface-400">
            Browse the champion library and download skins to populate your local Fantome cache.
          </p>
          <button
            onClick={onBrowse}
            className="mt-6 rounded-full bg-accent-500 px-6 py-2.5 text-xs font-bold text-on-accent shadow-md shadow-accent-500/20 transition-colors hover:bg-accent-400"
          >
            Browse Champions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-surface-800 bg-surface-900/60 p-4">
        <div>
          <span className="text-xs font-semibold text-surface-400">Total Installed Packages</span>
          <p className="mt-0.5 font-display text-xl font-bold text-white">{items.length} skins</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-xs font-semibold text-surface-400">Storage Footprint</span>
            <p className="mt-0.5 font-mono text-xl font-bold text-accent-400">
              {formatBytes(totalBytes)}
            </p>
          </div>
          <button
            onClick={checkForUpdates}
            disabled={isPatcherActive}
            className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Check for skin updates"
          >
            <ArrowClockwiseIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Check Updates</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 pb-12">
        {items.map(({ skin, entry }) => (
          <article
            key={entry.skinId}
            className={`group relative flex flex-col overflow-hidden rounded-2xl border transition-all ${
              entry.applied
                ? "border-success/50 bg-surface-900/90 shadow-md shadow-success/10"
                : "border-surface-800 bg-surface-900/80 hover:border-surface-700"
            }`}
          >
            {/* Artwork */}
            <div
              onClick={() => onInspect(skin)}
              className="relative h-32 w-full cursor-pointer overflow-hidden bg-surface-950"
            >
              <Artwork
                skin={skin}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-transparent to-transparent" />
              {entry.applied && (
                <span className="absolute top-2 right-2 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                  Applied
                </span>
              )}
              {(() => {
                const info = updateInfo[entry.skinId];
                const updating = updatingSkins[entry.skinId];
                if (!info && !updating) return null;
                if (updating) {
                  return (
                    <div className="absolute top-2 right-2 left-2 flex items-center gap-2 rounded-lg border border-accent-500/30 bg-surface-950/95 px-2 py-1 backdrop-blur-sm">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
                          <div
                            className="h-full bg-accent-500 transition-all duration-300"
                            style={{ width: `${updating.progress}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px] whitespace-nowrap text-accent-400">
                          {updating.status}
                        </span>
                      </div>
                    </div>
                  );
                }
                if (info?.updateAvailable) {
                  return (
                    <div className="absolute top-2 right-2 left-2 flex items-center gap-2 rounded-lg border border-accent-500/30 bg-accent-500/10 px-2 py-1 backdrop-blur-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-semibold text-accent-400">Update</span>
                        <span className="text-[10px] text-accent-300">
                          {info.localSize && info.remoteSize
                            ? `${formatBytes(info.localSize)} → ${formatBytes(info.remoteSize)}`
                            : "Available"}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Info */}
            <div className="flex flex-1 flex-col justify-between p-4">
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-accent-400 uppercase">
                  {skin.champion}
                </p>
                <h4
                  onClick={() => onInspect(skin)}
                  className="mt-0.5 cursor-pointer truncate font-display text-sm font-bold text-white hover:text-accent-300"
                >
                  {nameOf(skin)}
                </h4>
                <p className="mt-1 font-mono text-[11px] text-surface-500">
                  {formatBytes(Number(entry.fileSize))} ·{" "}
                  {new Date(entry.downloadedAt).toLocaleDateString()}
                </p>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                {(() => {
                  const info = updateInfo[entry.skinId];
                  const updating = updatingSkins[entry.skinId];
                  if (info?.updateAvailable && !updating) {
                    return (
                      <button
                        disabled={isPatcherActive || busy === entry.skinId}
                        onClick={() => handleUpdateSkin(entry.skinId)}
                        className="flex-1 rounded-xl border border-accent-500/30 bg-accent-500/20 py-2 text-xs font-bold text-accent-400 shadow-xs transition-all hover:border-accent-500/50 hover:bg-accent-500/30 disabled:opacity-50"
                      >
                        <ArrowClockwiseIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Update
                      </button>
                    );
                  }
                  return null;
                })()}
                {entry.applied ? (
                  <button
                    disabled={isPatcherActive || busy === skin.id}
                    onClick={() => void onUnapply(skin)}
                    className="flex-1 rounded-xl border border-success/50 bg-success/20 py-2 text-xs font-bold text-success-text transition-colors hover:bg-success/30 disabled:opacity-50"
                  >
                    Unapply
                  </button>
                ) : (
                  <button
                    disabled={isPatcherActive || busy === skin.id}
                    onClick={() => void onApply(skin)}
                    className="flex-1 rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent shadow-xs transition-colors hover:bg-accent-400 disabled:opacity-50"
                  >
                    {busy === skin.id ? "Applying…" : "Apply"}
                  </button>
                )}
                <button
                  disabled={isPatcherActive || busy === skin.id}
                  onClick={() => void onDelete(skin)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-surface-700 bg-surface-800 text-surface-400 transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger-text disabled:opacity-50"
                  title="Delete from cache"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function LocalModArtwork({ mod }: { mod: InstalledMod }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void api.getModThumbnail(mod.id).then((result) => {
      if (mounted && result.ok) setThumbnail(result.value ? convertFileSrc(result.value) : null);
    });
    return () => {
      mounted = false;
    };
  }, [mod.id]);

  if (!thumbnail)
    return (
      <div className="flex h-32 items-center justify-center bg-surface-950 text-[11px] font-semibold tracking-widest text-surface-500">
        NO ARTWORK
      </div>
    );
  return <img src={thumbnail} alt={mod.displayName} className="h-32 w-full object-cover" />;
}

function humanizeRuneForgeValue(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function RuneForgeArtwork({ mod, className }: { mod: RuneforgeMod; className: string }) {
  const [failed, setFailed] = useState(false);
  const thumbnail = useRuneforgeThumbnail(mod.thumbnailKey);
  const url = thumbnail.data ? convertFileSrc(thumbnail.data) : null;
  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-900 text-[10px] font-semibold tracking-[0.2em] text-surface-500 ${className}`}
      >
        NO ARTWORK
      </div>
    );
  }
  return (
    <img
      loading="lazy"
      src={url}
      alt={`${mod.name} thumbnail`}
      className={`${className} object-cover`}
      onError={() => setFailed(true)}
    />
  );
}

function RuneForgeView() {
  const [search, setSearch] = useState("");
  const [championId, setChampionId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [feature, setFeature] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RuneforgeMod | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const catalog = useRuneforgeCatalog({
    page,
    pageSize: 24,
    search: deferredSearch || null,
    championId,
    category,
    theme,
    feature,
  });
  const champions = useRuneforgeChampions();
  const totalPages = Math.max(1, Math.ceil((catalog.data?.total ?? 0) / 24));
  const categories = useMemo(
    () => filterValues(catalog.data?.mods.map((mod: RuneforgeMod) => mod.category)),
    [catalog.data],
  );
  const themes = useMemo(
    () => filterValues(catalog.data?.mods.flatMap((mod: RuneforgeMod) => mod.themes)),
    [catalog.data],
  );
  const features = useMemo(
    () => filterValues(catalog.data?.mods.flatMap((mod: RuneforgeMod) => mod.features)),
    [catalog.data],
  );

  useEffect(() => {
    setPage(0);
  }, [deferredSearch, championId, category, theme, feature]);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-surface-800 bg-gradient-to-br from-surface-900 to-surface-950 p-6 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.22em] text-accent-400">
              PUBLIC CATALOG
            </p>
            <h3 className="mt-1 font-display text-2xl font-bold text-white">RuneForge</h3>
            <p className="mt-2 max-w-2xl text-sm text-surface-400">
              Browse public RuneForge mod metadata in Exist Skin Manager. Releases and downloads
              remain unavailable until RuneForge exposes an anonymous asset API.
            </p>
          </div>
          <span className="rounded-full border border-surface-700 bg-surface-950 px-3 py-1 text-xs text-surface-400">
            {catalog.data ? `${catalog.data.total.toLocaleString()} mods` : "Loading catalog…"}
          </span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-surface-500"
              size={16}
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search RuneForge mods…"
              className="w-full rounded-xl border border-surface-700 bg-surface-950 py-2.5 pr-3 pl-9 text-sm text-white transition outline-none focus:border-accent-500"
            />
          </div>
          <select
            value={championId ?? ""}
            onChange={(event) =>
              setChampionId(event.target.value ? Number(event.target.value) : null)
            }
            className="rounded-xl border border-surface-700 bg-surface-950 px-3 text-sm text-surface-200 outline-none focus:border-accent-500"
          >
            <option value="">All champions</option>
            {(champions.data?.champions ?? []).map((champion) => (
              <option key={champion.id} value={champion.id}>
                {champion.name}
              </option>
            ))}
          </select>
          <RuneForgeFilter
            label="Category"
            value={category}
            values={categories}
            onChange={setCategory}
          />
          <RuneForgeFilter label="Theme" value={theme} values={themes} onChange={setTheme} />
          <RuneForgeFilter
            label="Feature"
            value={feature}
            values={features}
            onChange={setFeature}
          />
        </div>
      </div>

      {catalog.isError && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger-text">
          RuneForge catalog is unavailable: {catalog.error.message}
        </div>
      )}
      {!catalog.isError && catalog.isLoading && (
        <div className="flex justify-center py-16 text-sm text-surface-400">
          <CircleNotchIcon className="mr-2 h-5 w-5 animate-spin" />
          Loading public RuneForge catalog…
        </div>
      )}
      {!catalog.isError && !catalog.isLoading && catalog.data?.mods.length === 0 && (
        <div className="rounded-xl border border-surface-800 bg-surface-900 p-10 text-center text-sm text-surface-400">
          No public RuneForge mods matched these filters.
        </div>
      )}
      {catalog.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {catalog.data.mods.map((mod) => (
              <button
                key={mod.id}
                onClick={() => setSelected(mod)}
                className="group overflow-hidden rounded-xl border border-surface-800 bg-surface-900 text-left transition hover:-translate-y-0.5 hover:border-accent-500/60 hover:bg-surface-800"
              >
                <RuneForgeArtwork mod={mod} className="aspect-video w-full" />
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="line-clamp-2 font-display text-base font-bold text-white">
                      {mod.name}
                    </h4>
                    {mod.status && (
                      <span className="shrink-0 rounded-full bg-surface-800 px-2 py-0.5 text-[10px] font-semibold text-surface-300">
                        {humanizeRuneForgeValue(mod.status)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-surface-400">
                    by {mod.publisher?.username ?? "Unknown creator"}
                  </p>
                  <p className="line-clamp-2 text-xs leading-relaxed text-surface-500">
                    {mod.description || "No public description."}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {mod.champions.slice(0, 2).map((champion) => (
                      <span
                        key={champion.id}
                        className="rounded bg-accent-500/10 px-1.5 py-0.5 text-[10px] text-accent-300"
                      >
                        {champion.name}
                      </span>
                    ))}
                    {mod.themes.slice(0, 2).map((theme) => (
                      <span
                        key={theme}
                        className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] text-surface-400"
                      >
                        {humanizeRuneForgeValue(theme)}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-surface-800 pt-2 text-[11px] text-surface-500">
                    <span>{humanizeRuneForgeValue(mod.category)}</span>
                    <span>{mod.downloadCount.toLocaleString()} downloads</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-xl border border-surface-800 bg-surface-900 px-4 py-3 text-sm">
            <span className="text-surface-400">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
                className="rounded-lg border border-surface-700 px-3 py-1.5 text-surface-300 hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-lg border border-surface-700 px-3 py-1.5 text-surface-300 hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && <RuneForgeDetail mod={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function RuneForgeDetail({ mod, onClose }: { mod: RuneforgeMod; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <article
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-surface-700 bg-surface-950 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative">
          <RuneForgeArtwork mod={mod} className="aspect-[2/1] w-full" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 rounded-full bg-black/70 p-2 text-white hover:bg-black"
          >
            <XIcon size={16} />
          </button>
        </div>
        <div className="space-y-5 p-6">
          <div>
            <p className="text-xs text-surface-400">
              by {mod.publisher?.username ?? "Unknown creator"}
            </p>
            <h3 className="mt-1 font-display text-2xl font-bold text-white">{mod.name}</h3>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <DetailField label="Category" value={humanizeRuneForgeValue(mod.category)} />
            <DetailField label="Status" value={humanizeRuneForgeValue(mod.status)} />
            <DetailField label="Downloads" value={mod.downloadCount.toLocaleString()} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wider text-surface-500 uppercase">
              Champions
            </p>
            <TagList values={mod.champions.map((champion) => champion.name)} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wider text-surface-500 uppercase">
              Themes
            </p>
            <TagList values={mod.themes.map(humanizeRuneForgeValue)} empty="No public themes" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wider text-surface-500 uppercase">
              Features
            </p>
            <TagList values={mod.features.map(humanizeRuneForgeValue)} empty="No public features" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-surface-500 uppercase">
              Description
            </p>
            <p className="text-sm leading-6 whitespace-pre-wrap text-surface-300">
              {mod.description || "No public description."}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-surface-800 bg-surface-900 p-4">
            <p className="text-sm text-surface-400">
              Download unavailable from the public RuneForge API
            </p>
            <button
              disabled
              className="rounded-lg bg-surface-800 px-4 py-2 text-sm font-semibold text-surface-500"
            >
              Download unavailable
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-900 p-3">
      <p className="text-[10px] font-semibold tracking-wider text-surface-500 uppercase">{label}</p>
      <p className="mt-1 text-surface-200">{value}</p>
    </div>
  );
}
function TagList({ values, empty = "No public data" }: { values: string[]; empty?: string }) {
  return values.length ? (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full bg-accent-500/10 px-2.5 py-1 text-xs text-accent-300"
        >
          {value}
        </span>
      ))}
    </div>
  ) : (
    <p className="text-sm text-surface-500">{empty}</p>
  );
}
function filterValues(values: Array<string | null | undefined> | undefined) {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))].sort();
}
function RuneForgeFilter({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string | null;
  values: string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
      className="rounded-xl border border-surface-700 bg-surface-950 px-3 text-sm text-surface-200 outline-none focus:border-accent-500"
    >
      <option value="">All {label.toLowerCase()}s</option>
      {value && !values.includes(value) && (
        <option value={value}>{humanizeRuneForgeValue(value)}</option>
      )}
      {values.map((item) => (
        <option key={item} value={item}>
          {humanizeRuneForgeValue(item)}
        </option>
      ))}
    </select>
  );
}

function CustomSkinsView({
  mods,
  importing,
  isPatcherActive,
  onImport,
  onToggle,
  onUninstall,
}: {
  mods: InstalledMod[];
  importing: boolean;
  isPatcherActive: boolean;
  onImport: () => Promise<void>;
  onToggle: (mod: InstalledMod, enabled: boolean) => Promise<void>;
  onUninstall: (mod: InstalledMod) => Promise<void>;
}) {
  return (
    <section>
      <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-surface-800 bg-surface-900/60 p-5">
        <div>
          <p className="text-xs font-semibold tracking-wider text-surface-400">CUSTOM SKINS</p>
          <h3 className="mt-1 font-display text-xl font-bold text-white">Your imported skins</h3>
          <p className="mt-1 text-xs text-surface-500">
            Imported Fantome files use your configured LTK storage and active profile.
          </p>
        </div>
        <button
          onClick={() => void onImport()}
          disabled={importing || isPatcherActive}
          className="shrink-0 rounded-full bg-accent-500 px-4 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import Skins"}
        </button>
      </div>
      {!mods.length ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-surface-800 bg-surface-900/40 text-center">
          <h3 className="font-display text-lg font-bold text-white">No custom skins yet</h3>
          <p className="mt-2 max-w-sm text-xs text-surface-500">
            Import a Fantome skin to add it to the active LTK profile and patcher pipeline.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 pb-12">
          {mods.map((mod) => (
            <article
              key={mod.id}
              className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/80"
            >
              <LocalModArtwork mod={mod} />
              <div className="p-4">
                <p className="text-[11px] font-semibold tracking-wider text-accent-400 uppercase">
                  {mod.champions.join(" · ") || "Local mod"}
                </p>
                <h4 className="mt-0.5 truncate font-display text-sm font-bold text-white">
                  {mod.displayName}
                </h4>
                <p className="mt-1 text-[11px] text-surface-500">
                  {mod.version || "No version"}
                  {mod.authors[0] ? ` · ${mod.authors[0]}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {mod.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-surface-800 px-2 py-0.5 text-[10px] text-surface-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    disabled={isPatcherActive}
                    onClick={() => void onToggle(mod, !mod.enabled)}
                    className="flex-1 rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent disabled:opacity-50"
                  >
                    {mod.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    disabled={isPatcherActive}
                    onClick={() => void onUninstall(mod)}
                    className="rounded-xl border border-surface-700 px-3 text-xs font-semibold text-surface-300 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* ========================================================================= */
/* 6. DOWNLOADS & QUEUE VIEW                                                */
/* ========================================================================= */

function DownloadsView({
  progress,
  skins,
  queue,
  refreshQueue,
}: {
  progress: Record<string, Progress>;
  skins: ExistSkin[];
  queue: ExistDownloadTask[];
  refreshQueue: () => Promise<void>;
}) {
  const live = queue.filter((item) => !["completed", "failed", "cancelled"].includes(item.state));
  const failed = queue.filter((item) => item.state === "failed" || item.state === "cancelled");
  const completed = queue.filter((item) => item.state === "completed");

  function renderCard(task: ExistDownloadTask) {
    const skin = skins.find((s) => s.id === task.skinId);
    if (!skin) return null;

    const item = progress[task.skinId] ?? task;
    const percent = item.totalBytes
      ? Math.round((item.downloadedBytes / item.totalBytes) * 100)
      : 0;

    return (
      <article
        key={task.skinId}
        className="flex items-center gap-4 rounded-2xl border border-surface-800 bg-surface-900/80 p-4"
      >
        <Artwork skin={skin} className="h-16 w-20 shrink-0 rounded-xl object-cover" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h4 className="truncate font-display text-sm font-bold text-white">
              {skin.champion} · {nameOf(skin)}
            </h4>
            <span className="font-mono text-xs text-surface-400 capitalize">{task.state}</span>
          </div>

          {task.error ? (
            <p className="mt-1 text-xs text-danger-text">{task.error}</p>
          ) : task.state !== "completed" ? (
            <div className="mt-2 space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
                <div className="h-full bg-accent-500" style={{ width: `${percent}%` }} />
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-surface-500">
                <span>
                  {percent}% · {formatBytes(item.downloadedBytes)}
                  {item.totalBytes && ` / ${formatBytes(item.totalBytes)}`}
                </span>
                {item.bytesPerSecond ? <span>{formatBytes(item.bytesPerSecond)}/s</span> : null}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-success-text">Download completed & added to cache.</p>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex shrink-0 gap-2">
          {task.state === "downloading" && (
            <>
              <button
                onClick={() => void api.pauseExistDownload(task.skinId).then(refreshQueue)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-700 bg-surface-800 text-surface-300 hover:bg-surface-700"
                title="Pause"
              >
                <PauseIcon size={14} />
              </button>
              <button
                onClick={() => void api.cancelExistDownload(task.skinId).then(refreshQueue)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-700 bg-surface-800 text-surface-300 hover:bg-surface-700"
                title="Cancel"
              >
                <XIcon size={14} />
              </button>
            </>
          )}

          {task.state === "paused" && (
            <>
              <button
                onClick={() => void api.resumeExistDownload(task.skinId).then(refreshQueue)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500 text-on-accent hover:bg-accent-400"
                title="Resume"
              >
                <PlayIcon size={14} weight="bold" />
              </button>
              <button
                onClick={() => void api.cancelExistDownload(task.skinId).then(refreshQueue)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-700 bg-surface-800 text-surface-300 hover:bg-surface-700"
                title="Cancel"
              >
                <XIcon size={14} />
              </button>
            </>
          )}

          {(task.state === "failed" || task.state === "cancelled") && (
            <>
              <button
                onClick={() => void api.retryExistDownload(task.skinId).then(refreshQueue)}
                className="rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-400"
              >
                Retry
              </button>
              <button
                onClick={() => void api.removeExistDownload(task.skinId).then(refreshQueue)}
                className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-400 hover:text-white"
              >
                Remove
              </button>
            </>
          )}

          {task.state === "completed" && (
            <button
              onClick={() => void api.removeExistDownload(task.skinId).then(refreshQueue)}
              className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-400 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </article>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center text-center">
        <DownloadSimpleIcon size={40} className="mb-3 text-surface-600" />
        <h3 className="font-display text-lg text-white">No active downloads</h3>
        <p className="mt-1 text-xs text-surface-400">
          Downloads triggered from the library will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {live.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold tracking-widest text-accent-400 uppercase">
            Active & Queued ({live.length})
          </h3>
          <div className="space-y-3">{live.map(renderCard)}</div>
        </section>
      )}

      {failed.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold tracking-widest text-danger-text uppercase">
            Failed ({failed.length})
          </h3>
          <div className="space-y-3">{failed.map(renderCard)}</div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold tracking-widest text-success-text uppercase">
            Completed ({completed.length})
          </h3>
          <div className="space-y-3">{completed.map(renderCard)}</div>
        </section>
      )}
    </div>
  );
}

/* ========================================================================= */
/* 7. DETERMINISTIC FEATURED SKINS GRID                                     */
/* ========================================================================= */

function FeaturedGrid({
  skins,
  installedById,
  busy,
  isPatcherActive,
  onSelectSkin,
  onDownload,
  onApply,
  onUnapply,
}: {
  skins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  busy: string | null;
  isPatcherActive: boolean;
  onSelectSkin: (skin: ExistSkin) => void;
  onDownload: (skin: ExistSkin) => Promise<void>;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-surface-800 bg-gradient-to-r from-accent-500/10 via-surface-900 to-surface-900 p-6">
        <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-accent-400 uppercase">
          <SparkleIcon weight="fill" size={16} />
          Curated Catalog Highlights
        </div>
        <h3 className="mt-1 font-display text-2xl font-bold text-white">
          Featured Community Fantomes
        </h3>
        <p className="mt-1 max-w-xl text-xs text-surface-400">
          Deterministic featured selection with verified Fantome archives from the Finder
          repository.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 pb-12">
        {skins.map((skin) => {
          const entry = installedById.get(skin.id);

          return (
            <article
              key={skin.id}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/80 transition-all hover:border-surface-700"
            >
              {/* Artwork */}
              <div
                onClick={() => onSelectSkin(skin)}
                className="relative h-36 w-full cursor-pointer overflow-hidden bg-surface-950"
              >
                <Artwork
                  skin={skin}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-transparent to-transparent" />
                {entry?.applied && (
                  <span className="absolute top-2 right-2 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                    Applied
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col justify-between p-4">
                <div>
                  <p className="text-[11px] font-semibold tracking-wider text-accent-400 uppercase">
                    {skin.champion}
                  </p>
                  <h4
                    onClick={() => onSelectSkin(skin)}
                    className="mt-0.5 cursor-pointer truncate font-display text-sm font-bold text-white hover:text-accent-300"
                  >
                    {nameOf(skin)}
                  </h4>
                  <p className="mt-1 text-[11px] text-surface-500">Skin ID #{skin.id}</p>
                </div>

                {/* Actions */}
                <div className="mt-4">
                  {entry?.applied ? (
                    <button
                      disabled={isPatcherActive || busy === skin.id}
                      onClick={() => void onUnapply(skin)}
                      className="w-full cursor-pointer rounded-xl border border-success/50 bg-success/20 py-2 text-xs font-bold text-success-text transition-colors hover:bg-success/30 disabled:opacity-50"
                    >
                      Unapply
                    </button>
                  ) : entry ? (
                    <button
                      disabled={isPatcherActive || busy === skin.id}
                      onClick={() => void onApply(skin)}
                      className="w-full cursor-pointer rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent shadow-xs transition-colors hover:bg-accent-400 disabled:opacity-50"
                    >
                      {busy === skin.id ? "Applying…" : "Apply"}
                    </button>
                  ) : (
                    <button
                      onClick={() => void onDownload(skin)}
                      className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent shadow-xs transition-colors hover:bg-accent-400"
                    >
                      <DownloadSimpleIcon size={14} weight="bold" />
                      Download
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
