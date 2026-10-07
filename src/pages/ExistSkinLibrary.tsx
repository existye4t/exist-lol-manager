import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  ProhibitIcon,
  SparkleIcon,
  StopIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { useToast } from "@/components";
import {
  api,
  type ExistDownloadTask,
  type ExistSkin,
  type ExistSkinUpdateInfo,
  type InstalledExistSkin,
  type InstalledMod,
  type RuneforgeInstalledRecord,
  type RuneforgeMod,
} from "@/lib/tauri";
import { useGuardedStartPatcher, useOverlayProgress } from "@/modules/library";
import { usePatcherStatus, useStopPatcher } from "@/modules/patcher";
import { useRuneforgeCatalog, useRuneforgeChampions, useRuneforgeThumbnail } from "@/modules/runeforge/api";
import { usePatcherSessionStore } from "@/stores";
import { formatBytes } from "@/utils/formatBytes";

function formatAppError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if ("message" in err && typeof (err as any).message === "string") return (err as any).message;
    if ("code" in err && typeof (err as any).code === "string") return (err as any).code;
  }
  return String(err);
}

// Module-level persistent cache across route changes
let cachedCatalogSkins: ExistSkin[] = [];
let cachedInstalledSkins: InstalledExistSkin[] = [];
let cachedDownloadQueue: ExistDownloadTask[] = [];
let cachedLocalModsList: InstalledMod[] = [];
let cachedUpdateStatuses: Record<string, ExistSkinUpdateInfo> = {};
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
      <div className={`flex items-center justify-center bg-surface-900 text-xs font-semibold tracking-widest text-surface-500 ${className}`}>
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
  const [skins, setSkins] = useState<ExistSkin[]>(cachedCatalogSkins);
  const [installed, setInstalled] = useState<InstalledExistSkin[]>(cachedInstalledSkins);
  const [view, setView] = useState<View>("library");
  const [query, setQuery] = useState("");
  const [selectedChampionName, setSelectedChampionName] = useState<string | null>(null);
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    cachedCatalogSkins.length > 0
      ? `Catalog ready (${cachedCatalogSkins.length} skins)`
      : "Loading Exist catalog…"
  );
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [queue, setQueue] = useState<ExistDownloadTask[]>(cachedDownloadQueue);
  const [localMods, setLocalMods] = useState<InstalledMod[]>(cachedLocalModsList);
  const [importing, setImporting] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, ExistSkinUpdateInfo>>(cachedUpdateStatuses);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingSkinId, setUpdatingSkinId] = useState<string | null>(null);
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

  const [runeforgeRecords, setRuneforgeRecords] = useState<RuneforgeInstalledRecord[]>([]);

  async function refreshInstalled() {
    const result = await api.getInstalledExistSkins();
    if (result.ok && Array.isArray(result.value)) {
      cachedInstalledSkins = result.value;
      setInstalled(result.value);
    }
  }

  async function refreshQueue() {
    const result = await api.getExistDownloadQueue();
    if (result.ok && Array.isArray(result.value)) {
      cachedDownloadQueue = result.value;
      setQueue(result.value);
    }
  }

  async function refreshLocalMods() {
    const result = await api.getInstalledMods();
    if (result.ok && Array.isArray(result.value)) {
      cachedLocalModsList = result.value;
      setLocalMods(result.value);
    }
  }

  const refreshRuneforgeRecords = useCallback(async () => {
    const result = await api.getRuneforgeInstalledRecords();
    if (result.ok && Array.isArray(result.value)) {
      setRuneforgeRecords(result.value);
    }
  }, []);

  async function checkUpdates() {
    setCheckingUpdates(true);
    try {
      const result = await api.getExistSkinsUpdateStatus();
      if (result.ok && Array.isArray(result.value)) {
        const map: Record<string, ExistSkinUpdateInfo> = {};
        for (const item of result.value) {
          map[item.skinId] = item;
        }
        cachedUpdateStatuses = map;
        setUpdateStatuses(map);
      }
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function handleUpdateSkin(skin: ExistSkin) {
    if (isPatcherActive) {
      toast.warning("Patcher Active", "Please stop the patcher before updating skins.");
      return;
    }
    setUpdatingSkinId(skin.id);
    toast.info("Updating skin", `Downloading updated version of ${nameOf(skin)}…`);
    const result = await api.updateExistSkin(skin.id);
    setUpdatingSkinId(null);
    if (result.ok) {
      toast.success("Skin updated", `${nameOf(skin)} has been updated to the latest version.`);
      await refreshInstalled();
      await checkUpdates();
    } else {
      toast.error("Update failed", formatAppError(result.error));
    }
  }

  useEffect(() => {
    void api.getExistCatalog().then((result) => {
      if (!result.ok || !result.value) {
        if (cachedCatalogSkins.length === 0) {
          setStatusMessage("Catalog offline. Using cached catalog.");
        }
        return;
      }
      if (Array.isArray(result.value.skins)) {
        cachedCatalogSkins = result.value.skins;
        setSkins(result.value.skins);
      }
      setStatusMessage(result.value.fromCache ? "Offline library" : `Catalog v${result.value.version}`);
    });
    void refreshInstalled();
    void refreshQueue();
    void refreshLocalMods();
    void refreshRuneforgeRecords();
    void checkUpdates();
  }, [refreshRuneforgeRecords]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("library-changed", () => {
      void refreshLocalMods();
      void refreshRuneforgeRecords();
      void refreshInstalled();
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [refreshRuneforgeRecords]);

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

  const safeInstalled = Array.isArray(installed) ? installed : [];
  const installedById = useMemo(() => new Map(safeInstalled.map((item) => [item.skinId, item])), [safeInstalled]);
  const appliedCount = useMemo(() => safeInstalled.filter((item) => item.applied).length, [safeInstalled]);

  const runeforgeRecordByModId = useMemo(() => {
    const map = new Map<string, RuneforgeInstalledRecord>();
    for (const record of runeforgeRecords) {
      if (record.installedId) map.set(record.installedId.toLowerCase(), record);
      if (record.modId) map.set(record.modId.toLowerCase(), record);
      if (record.name) map.set(record.name.toLowerCase().trim(), record);
    }
    return map;
  }, [runeforgeRecords]);

  const isRuneForgeMod = useCallback(
    (mod: InstalledMod) => {
      if (mod.tags?.some((t) => t.toLowerCase() === "runeforge")) return true;
      if (runeforgeRecordByModId.has(mod.id.toLowerCase())) return true;
      if (runeforgeRecordByModId.has(mod.name.toLowerCase().trim())) return true;
      if (runeforgeRecordByModId.has(mod.displayName.toLowerCase().trim())) return true;
      return false;
    },
    [runeforgeRecordByModId]
  );

  const runeForgeInstalledMods = useMemo(
    () => localMods.filter(isRuneForgeMod),
    [localMods, isRuneForgeMod]
  );
  const totalInstalledCount = safeInstalled.length + runeForgeInstalledMods.length;

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
      return champ.skins.some((skin) => `${skin.name} ${skin.nameEn}`.toLocaleLowerCase("tr").includes(needle));
    });
  }, [champions, query]);

  // Cached skins list
  const cachedItems = useMemo(() => {
    return safeInstalled.flatMap((entry) => {
      const skin = skins.find((item) => item.id === entry.skinId);
      return skin ? [{ skin, entry }] : [];
    });
  }, [safeInstalled, skins]);

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
      await refreshLocalMods();
    }
  }

  async function handleUnapply(skin: ExistSkin) {
    if (isPatcherActive) return;
    setBusy(skin.id);
    const result = await api.unapplyExistSkin(skin.id);
    setBusy(null);
    if (result.ok) {
      await refreshInstalled();
      await refreshLocalMods();
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
      await refreshLocalMods();
      await refreshRuneforgeRecords();
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
      toast.error("Import failed", formatAppError(result.error));
      return;
    }
    const outcome = result.value;
    const mod = outcome.mod;
    setLocalMods((mods) => [mod, ...mods.filter((m) => m.id !== mod.id)]);
    toast.success("Skin imported", `${mod.displayName} was added to your local library.`);
  }

  async function handleLocalToggle(mod: InstalledMod, enabled: boolean) {
    const result = await api.toggleMod(mod.id, enabled);
    if (result.ok) {
      await refreshLocalMods();
      await refreshInstalled();
    } else {
      toast.error("Could not update skin", formatAppError(result.error));
    }
  }

  async function handleLocalUninstall(mod: InstalledMod) {
    if (isPatcherActive) return;
    if (mod.enabled) {
      await api.toggleMod(mod.id, false);
    }
    const result = await api.uninstallMod(mod.id);
    if (result.ok) {
      setLocalMods((mods) => mods.filter((item) => item.id !== mod.id));
      await refreshInstalled();
      await refreshLocalMods();
      await refreshRuneforgeRecords();
      toast.success("Skin removed", `${mod.displayName} was removed from your local library.`);
    } else {
      toast.error("Could not remove skin", formatAppError(result.error));
    }
  }

  async function handleResetActiveMods() {
    if (isPatcherActive) return;
    const enabledList = localMods.filter((mod) => mod.enabled);
    for (const mod of enabledList) {
      await api.toggleMod(mod.id, false);
    }
    for (const skin of safeInstalled.filter((s) => s.applied)) {
      await api.unapplyExistSkin(skin.skinId);
    }
    await refreshLocalMods();
    await refreshInstalled();
    toast.success("Selection reset", "All enabled skins were unapplied.");
  }

  function openChampion(champName: string, skinId?: string) {
    setSelectedChampionName(champName);
    setSelectedSkinId(skinId ?? null);
  }

  function closeDrawer() {
    setSelectedChampionName(null);
    setSelectedSkinId(null);
  }

  const activeDownloadCount = queue.filter((t) => !["completed", "failed", "cancelled"].includes(t.state)).length;
  const enabledModCount = localMods.filter((mod) => mod.enabled).length;

  return (
    <div className="flex h-full min-h-0 bg-surface-950 text-surface-100 font-sans select-none">
      {/* Sidebar Navigation */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-surface-800 bg-surface-900/90 p-5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-md shadow-accent-500/20">
            <SparkleIcon weight="fill" className="h-5 w-5 text-on-accent" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-white">EXIST</h1>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-accent-400">SKIN MANAGER</p>
          </div>
        </div>

        {/* Global Patcher Status Indicator */}
        <div className="mt-6 rounded-xl border border-surface-800 bg-surface-950/60 p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-surface-400">Patcher Status</span>
            {isPatcherRunning ? (
              <span className="flex items-center gap-1.5 font-semibold text-success-text">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse shadow-[0_0_8px] shadow-success" />
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
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-danger/40 bg-danger/10 py-2 text-xs font-semibold text-danger-text hover:bg-danger/20 transition-colors"
              >
                <StopIcon weight="bold" className="h-3.5 w-3.5" />
                {stopping ? "Stopping…" : "Stop Patcher"}
              </button>
            ) : (
              <button
                disabled={isPatcherBuilding || enabledModCount === 0}
                onClick={() => void startPatcher({})}
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all shadow-sm ${
                  enabledModCount > 0
                    ? "bg-accent-500 text-on-accent hover:bg-accent-400 shadow-accent-500/25 cursor-pointer"
                    : "bg-surface-800 text-surface-500 cursor-not-allowed"
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
          {enabledModCount > 0 && !isPatcherActive && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-surface-400">
              <span>{enabledModCount} selected</span>
              <button
                onClick={() => void handleResetActiveMods()}
                className="font-semibold text-accent-400 hover:text-accent-300 hover:underline cursor-pointer"
                title="Deselect all enabled skins"
              >
                Reset
              </button>
            </div>
          )}
          {enabledModCount === 0 && !isPatcherActive && (
            <p className="mt-2 text-[11px] text-surface-500 leading-tight">Enable a skin to start the patcher</p>
          )}
        </div>

        {/* Navigation List */}
        <nav className="mt-6 space-y-1.5">
          <button
            onClick={() => setView("library")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "library" ? "bg-accent-500 text-on-accent font-semibold" : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Champions</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${view === "library" ? "bg-black/20 text-on-accent" : "bg-surface-800 text-surface-400"}`}>
              {champions.length}
            </span>
          </button>

          <button
            onClick={() => setView("featured")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "featured" ? "bg-accent-500 text-on-accent font-semibold" : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Featured Skins</span>
            <SparkleIcon className="h-4 w-4 opacity-70" />
          </button>

          <button
            onClick={() => setView("downloads")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "downloads" ? "bg-accent-500 text-on-accent font-semibold" : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Downloads</span>
            {activeDownloadCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-[11px] font-bold text-on-accent animate-pulse">
                {activeDownloadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setView("cache")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "cache" ? "bg-accent-500 text-on-accent font-semibold" : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Installed & Cache</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${view === "cache" ? "bg-black/20 text-on-accent" : "bg-surface-800 text-surface-400"}`}>
              {totalInstalledCount}
            </span>
          </button>
          <button
            onClick={() => setView("custom")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "custom" ? "bg-accent-500 text-on-accent font-semibold" : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>Custom Skins</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${view === "custom" ? "bg-black/20 text-on-accent" : "bg-surface-800 text-surface-400"}`}>{localMods.length}</span>
          </button>
          <button
            onClick={() => setView("runeforge")}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              view === "runeforge" ? "bg-accent-500 text-on-accent font-semibold" : "text-surface-300 hover:bg-surface-800/70 hover:text-white"
            }`}
          >
            <span>RuneForge</span>
            <span className="text-[10px] font-bold tracking-wide opacity-75">PUBLIC</span>
          </button>
        </nav>

        {/* Footer State Info */}
        <div className="mt-auto pt-4 border-t border-surface-800/60 text-xs text-surface-500 flex flex-col gap-1">
          <div className="flex justify-between items-center">
            <span>Applied skins:</span>
            <span className="font-semibold text-accent-400">{appliedCount}</span>
          </div>
          <p className="truncate text-[11px] text-surface-500 mt-1">{statusMessage}</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
        {/* Top App Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-surface-800 bg-surface-950/80 px-8 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-white tracking-tight">
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
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" size={16} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search champions or skins…"
              className="w-full rounded-full border border-surface-700 bg-surface-900/90 py-2 pl-9 pr-8 text-xs text-white placeholder-surface-500 outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-white">
                <XIcon size={14} />
              </button>
            )}
          </div>
        </header>

        {/* Patcher Lock Banner */}
        {isPatcherActive && (
          <div className="flex items-center justify-between border-b border-accent-500/30 bg-accent-500/10 px-8 py-2 text-xs text-accent-300">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent-400 animate-ping" />
              Patcher is currently active. Skin modification is locked until patching finishes or stops.
            </span>
            <span className="font-mono text-[11px] opacity-75">{overlayProgress ? `${overlayProgress.stage}` : "Injecting mods"}</span>
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
              skins={skins.filter((s) => s.hasFantome).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 16)}
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
                localMods={localMods}
                runeforgeRecords={runeforgeRecords}
                isRuneForgeMod={isRuneForgeMod}
                busy={busy}
                isPatcherActive={isPatcherActive}
                updateStatuses={updateStatuses}
                updatingSkinId={updatingSkinId}
                checkingUpdates={checkingUpdates}
                onApply={handleApply}
                onUnapply={handleUnapply}
                onDelete={handleDelete}
                onToggleLocalMod={handleLocalToggle}
                onUninstallLocalMod={handleLocalUninstall}
                onUpdate={handleUpdateSkin}
                onCheckUpdates={checkUpdates}
                onInspect={(skin) => openChampion(skin.champion, skin.id)}
                onBrowse={() => setView("library")}
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
              runeforgeRecordByModId={runeforgeRecordByModId}
            />
          )}

          {view === "runeforge" && (
            <RuneForgeView
              isPatcherActive={isPatcherActive}
              localMods={localMods}
              onRefreshLocalMods={async () => {
                await refreshLocalMods();
                await refreshRuneforgeRecords();
                await refreshInstalled();
              }}
            />
          )}

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
            updateStatuses={updateStatuses}
            updatingSkinId={updatingSkinId}
            onClose={closeDrawer}
            onSelectSkin={(skin) => setSelectedSkinId(skin.id)}
            onBackToSkins={() => setSelectedSkinId(null)}
            onDownload={handleDownload}
            onApply={handleApply}
            onUnapply={handleUnapply}
            onDelete={handleDelete}
            onUpdate={handleUpdateSkin}
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
        <ProhibitIcon size={40} className="text-surface-600 mb-3" />
        <h3 className="font-display text-lg text-white">No champions found</h3>
        <p className="text-xs text-surface-400 mt-1">Try refining your search query.</p>
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
            className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
              isSelected
                ? "border-accent-500 bg-surface-850 shadow-lg shadow-accent-500/10 scale-[1.02]"
                : hasApplied
                ? "border-success/40 bg-surface-900/90 hover:border-success/70 hover:scale-[1.01]"
                : "border-surface-800 bg-surface-900/80 hover:border-surface-600 hover:scale-[1.01]"
            }`}
          >
            {/* Splash Artwork */}
            <div className="relative h-36 w-full overflow-hidden bg-surface-950">
              <Artwork skin={champ.baseSkin} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
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
                  <span className="rounded-full bg-surface-900/80 border border-surface-700 px-2 py-0.5 text-[10px] font-medium text-surface-300">
                    {champ.installedCount} cached
                  </span>
                )}
              </div>
            </div>

            {/* Champion Info */}
            <div className="flex flex-1 flex-col justify-between p-4">
              <div>
                <h3 className="font-display text-base font-bold text-white group-hover:text-accent-300 transition-colors">
                  {champ.name}
                </h3>
                {champ.nameEn !== champ.name && (
                  <p className="text-[11px] text-surface-500 truncate">{champ.nameEn}</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-surface-800/80 pt-2.5 text-xs text-surface-400">
                <span>{champ.totalSkins} skins</span>
                <span className="flex items-center gap-1 text-[11px] text-accent-400 group-hover:translate-x-0.5 transition-transform">
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
  updateStatuses,
  updatingSkinId,
  onClose,
  onSelectSkin,
  onBackToSkins,
  onDownload,
  onApply,
  onUnapply,
  onDelete,
  onUpdate,
}: {
  champion: ChampionSummary;
  selectedSkin: ExistSkin | null;
  allSkins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  progress: Record<string, Progress>;
  queue: ExistDownloadTask[];
  busy: string | null;
  isPatcherActive: boolean;
  updateStatuses: Record<string, ExistSkinUpdateInfo>;
  updatingSkinId: string | null;
  onClose: () => void;
  onSelectSkin: (skin: ExistSkin) => void;
  onBackToSkins: () => void;
  onDownload: (skin: ExistSkin) => Promise<void>;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
  onDelete: (skin: ExistSkin) => Promise<void>;
  onUpdate: (skin: ExistSkin) => Promise<void>;
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-[480px] max-w-[90vw] flex-col border-l border-surface-800 bg-surface-900 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="relative h-44 shrink-0 overflow-hidden bg-surface-950">
        <Artwork
          skin={selectedSkin ?? champion.baseSkin}
          className="h-full w-full object-cover brightness-75"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/60 to-transparent" />

        {/* Top Controls */}
        <div className="absolute top-3 left-4 right-4 flex items-center justify-between">
          {selectedSkin ? (
            <button
              onClick={onBackToSkins}
              className="flex items-center gap-1.5 rounded-full bg-surface-900/80 border border-surface-700 px-3 py-1 text-xs font-semibold text-surface-200 hover:bg-surface-800 transition-colors"
            >
              <ArrowLeftIcon size={12} weight="bold" />
              All {champion.name} Skins
            </button>
          ) : (
            <span className="rounded-full bg-surface-900/80 border border-surface-700 px-2.5 py-0.5 text-[11px] font-semibold text-surface-300">
              {champion.totalSkins} skins available
            </span>
          )}

          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-900/80 border border-surface-700 text-surface-300 hover:bg-surface-800 hover:text-white transition-colors"
            aria-label="Close"
          >
            <XIcon size={14} weight="bold" />
          </button>
        </div>

        {/* Header Title Info */}
        <div className="absolute bottom-3 left-5 right-5">
          <p className="text-[11px] font-semibold tracking-widest text-accent-400 uppercase">
            {champion.name}
          </p>
          <h2 className="font-display text-2xl font-bold text-white truncate">
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
            updateStatuses={updateStatuses}
            updatingSkinId={updatingSkinId}
            onSelectSkin={onSelectSkin}
            onDownload={onDownload}
            onApply={onApply}
            onUnapply={onUnapply}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        ) : (
          <ChampionSkinsList
            skins={champion.skins}
            installedById={installedById}
            progress={progress}
            queue={queue}
            updateStatuses={updateStatuses}
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
  updateStatuses,
  onSelectSkin,
}: {
  skins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  progress: Record<string, Progress>;
  queue: ExistDownloadTask[];
  updateStatuses: Record<string, ExistSkinUpdateInfo>;
  onSelectSkin: (skin: ExistSkin) => void;
}) {
  const baseSkins = skins.filter((s) => !s.parentSkinId);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-surface-800 text-xs text-surface-400">
        <span>Select a skin to download or apply</span>
        <span>{baseSkins.length} items</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {baseSkins.map((skin) => {
          const entry = installedById.get(skin.id);
          const task = queue.find((q) => q.skinId === skin.id);
          const prog = progress[skin.id];
          const isDownloading = task?.state === "downloading";
          const percent = prog?.totalBytes ? Math.round((prog.downloadedBytes / prog.totalBytes) * 100) : 0;
          const hasUpdate = Boolean(updateStatuses[skin.id]?.updateAvailable);

          return (
            <button
              key={skin.id}
              onClick={() => onSelectSkin(skin)}
              className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                entry?.applied
                  ? "border-success/50 bg-success/5 hover:border-success"
                  : hasUpdate
                  ? "border-amber-500/50 bg-amber-500/5 hover:border-amber-400"
                  : entry
                  ? "border-surface-700 bg-surface-850 hover:border-surface-500"
                  : "border-surface-800 bg-surface-900/60 hover:border-surface-600 hover:bg-surface-850"
              }`}
            >
              {/* Artwork */}
              <div className="relative h-24 w-full overflow-hidden bg-surface-950">
                <Artwork skin={skin} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-transparent to-transparent" />

                {/* Status Badges */}
                <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
                  {hasUpdate && (
                    <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-extrabold text-black shadow-xs">
                      Update
                    </span>
                  )}
                  {entry?.applied ? (
                    <span className="rounded-full bg-success px-1.5 py-0.5 text-[9px] font-bold text-white shadow-xs">
                      Applied
                    </span>
                  ) : entry ? (
                    <span className="rounded-full bg-surface-900/80 border border-surface-700 px-1.5 py-0.5 text-[9px] font-medium text-surface-300">
                      Installed
                    </span>
                  ) : isDownloading ? (
                    <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[9px] font-bold text-on-accent animate-pulse">
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
                <h4 className="font-semibold text-xs text-white truncate group-hover:text-accent-300 transition-colors">
                  {nameOf(skin)}
                </h4>
                <p className="text-[10px] text-surface-500 mt-0.5 truncate">
                  ID {skin.id}
                </p>
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
  updateStatuses,
  updatingSkinId,
  onSelectSkin,
  onDownload,
  onApply,
  onUnapply,
  onDelete,
  onUpdate,
}: {
  skin: ExistSkin;
  allSkins: ExistSkin[];
  installedById: Map<string, InstalledExistSkin>;
  progress: Record<string, Progress>;
  queue: ExistDownloadTask[];
  busy: string | null;
  isPatcherActive: boolean;
  updateStatuses: Record<string, ExistSkinUpdateInfo>;
  updatingSkinId: string | null;
  onSelectSkin: (skin: ExistSkin) => void;
  onDownload: (skin: ExistSkin) => Promise<void>;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
  onDelete: (skin: ExistSkin) => Promise<void>;
  onUpdate: (skin: ExistSkin) => Promise<void>;
}) {
  const entry = installedById.get(skin.id);
  const task = queue.find((q) => q.skinId === skin.id);
  const prog = progress[skin.id] ?? task;
  const updateInfo = updateStatuses[skin.id];
  const hasUpdate = Boolean(updateInfo?.updateAvailable);
  const isUpdating = updatingSkinId === skin.id;

  const isDownloading = task?.state === "downloading" || task?.state === "queued" || task?.state === "pausing";
  const isPaused = task?.state === "paused";
  const isFailed = task?.state === "failed" || task?.state === "cancelled";
  const percent = prog?.totalBytes ? Math.round((prog.downloadedBytes / prog.totalBytes) * 100) : 0;

  // Sibling chromas
  const chromas = useMemo(() => {
    const parentId = skin.parentSkinId ?? skin.id;
    return allSkins.filter((s) => s.parentSkinId === parentId || (s.id === parentId && s.id !== skin.id));
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
            <span className="text-surface-500 block">Skin Number</span>
            <span className="font-semibold text-white">#{skin.skinNum}</span>
          </div>
          <div>
            <span className="text-surface-500 block">Package ID</span>
            <span className="font-mono text-white">{skin.id}</span>
          </div>
          <div>
            <span className="text-surface-500 block">Fantome Source</span>
            <span className={skin.hasFantome ? "text-success-text font-semibold" : "text-surface-400"}>
              {skin.hasFantome ? "Available" : "Unavailable"}
            </span>
          </div>
          <div>
            <span className="text-surface-500 block">Status</span>
            <span className="font-semibold text-white flex items-center gap-1.5">
              {entry?.applied ? "Applied" : entry ? "Installed" : isDownloading ? "Downloading" : "Not installed"}
              {hasUpdate && (
                <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[10px] text-amber-300 font-bold">
                  Update
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Download / Progress Bar Section */}
      {isDownloading && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-500/5 p-4 space-y-3">
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

          <div className="flex items-center justify-between text-[11px] text-surface-400 font-mono">
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
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-center justify-between text-xs">
          <span className="text-warning-text font-medium">Download paused</span>
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
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-xs space-y-2">
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
        {hasUpdate && (
          <button
            disabled={isPatcherActive || isUpdating || busy === skin.id}
            onClick={() => void onUpdate(skin)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 py-3 text-sm font-bold text-black transition-all cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            {isUpdating ? (
              <>
                <CircleNotchIcon className="h-4 w-4 animate-spin" />
                <span>Updating to Latest Version…</span>
              </>
            ) : (
              <>
                <ArrowClockwiseIcon weight="bold" className="h-4 w-4" />
                <span>UPDATE TO LATEST VERSION</span>
              </>
            )}
          </button>
        )}

        {entry?.applied ? (
          <button
            disabled={isPatcherActive || busy === skin.id || isUpdating}
            onClick={() => void onUnapply(skin)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-success/50 bg-success/20 py-3 text-sm font-bold text-success-text hover:bg-success/30 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-success/10"
          >
            <CheckCircleIcon weight="fill" className="h-4 w-4" />
            {busy === skin.id ? "Unapplying…" : "UNAPPLY SKIN"}
          </button>
        ) : entry ? (
          <button
            disabled={isPatcherActive || busy === skin.id || isUpdating}
            onClick={() => void onApply(skin)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 text-sm font-bold text-on-accent hover:bg-accent-400 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent-500/20"
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
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-3 text-sm font-bold text-on-accent hover:bg-accent-400 transition-all cursor-pointer shadow-lg shadow-accent-500/20"
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
            disabled={isPatcherActive || busy === skin.id || isUpdating}
            onClick={() => void onDelete(skin)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-surface-800 bg-surface-950/40 py-2 text-xs font-semibold text-surface-400 hover:border-danger/40 hover:text-danger-text hover:bg-danger/5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <TrashIcon size={14} />
            Delete from Cache
          </button>
        )}
      </div>

      {/* Chroma Relationships */}
      {parentSkin && (
        <div className="border-t border-surface-800 pt-4">
          <span className="text-xs font-semibold text-surface-400 block mb-2">Base Skin</span>
          <button
            onClick={() => onSelectSkin(parentSkin)}
            className="flex items-center gap-3 w-full rounded-xl border border-surface-800 bg-surface-950/50 p-2.5 hover:border-surface-600 transition-colors text-left"
          >
            <Artwork skin={parentSkin} className="h-10 w-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{nameOf(parentSkin)}</p>
              <p className="text-[11px] text-surface-500">Parent Skin</p>
            </div>
            <CaretRightIcon size={14} className="text-surface-500" />
          </button>
        </div>
      )}

      {chromas.length > 0 && (
        <div className="border-t border-surface-800 pt-4">
          <span className="text-xs font-semibold text-surface-400 block mb-2">
            Chromas & Variants ({chromas.length})
          </span>
          <div className="grid grid-cols-2 gap-2">
            {chromas.map((chroma) => (
              <button
                key={chroma.id}
                onClick={() => onSelectSkin(chroma)}
                className="flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-950/50 p-2 hover:border-surface-600 transition-colors text-left"
              >
                <Artwork skin={chroma} className="h-8 w-10 rounded object-cover" />
                <span className="text-[11px] font-medium text-surface-300 truncate">
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

function LocalModArtwork({
  mod,
  thumbnailKey,
}: {
  mod: InstalledMod;
  thumbnailKey?: string | null;
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setFailed(false);

    async function load() {
      const result = await api.getModThumbnail(mod.id);
      if (!mounted) return;
      if (result.ok && result.value) {
        setThumbnail(convertFileSrc(result.value));
        return;
      }
      if (thumbnailKey) {
        const rfResult = await api.getRuneforgeThumbnail(thumbnailKey);
        if (!mounted) return;
        if (rfResult.ok && rfResult.value) {
          setThumbnail(convertFileSrc(rfResult.value));
          return;
        }
      }
      setThumbnail(null);
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [mod.id, thumbnailKey]);

  if (!thumbnail || failed)
    return (
      <div className="flex h-32 items-center justify-center bg-surface-950 text-[11px] font-semibold tracking-widest text-surface-500">
        NO ARTWORK
      </div>
    );
  return (
    <img
      src={thumbnail}
      alt={mod.displayName}
      className="h-32 w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/* ========================================================================= */
/* 5. CACHE / INSTALLED VIEW                                                */
/* ========================================================================= */

type PackageSource = "all" | "exist" | "runeforge";
type PackageCategory = "all" | "skin" | "map" | "ui" | "sound" | "other";

function CacheView({
  items,
  localMods,
  runeforgeRecords,
  isRuneForgeMod,
  busy,
  isPatcherActive,
  updateStatuses,
  updatingSkinId,
  checkingUpdates,
  onApply,
  onUnapply,
  onDelete,
  onToggleLocalMod,
  onUninstallLocalMod,
  onUpdate,
  onCheckUpdates,
  onInspect,
  onBrowse,
}: {
  items: { skin: ExistSkin; entry: InstalledExistSkin }[];
  localMods: InstalledMod[];
  runeforgeRecords: RuneforgeInstalledRecord[];
  isRuneForgeMod: (mod: InstalledMod) => boolean;
  busy: string | null;
  isPatcherActive: boolean;
  updateStatuses: Record<string, ExistSkinUpdateInfo>;
  updatingSkinId: string | null;
  checkingUpdates: boolean;
  onApply: (skin: ExistSkin) => Promise<void>;
  onUnapply: (skin: ExistSkin) => Promise<void>;
  onDelete: (skin: ExistSkin) => Promise<void>;
  onToggleLocalMod: (mod: InstalledMod, enabled: boolean) => Promise<void>;
  onUninstallLocalMod: (mod: InstalledMod) => Promise<void>;
  onUpdate: (skin: ExistSkin) => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onInspect: (skin: ExistSkin) => void;
  onBrowse: () => void;
}) {
  // Staged filter inputs
  const [searchInput, setSearchInput] = useState("");
  const [sourceInput, setSourceInput] = useState<PackageSource>("all");
  const [categoryInput, setCategoryInput] = useState<PackageCategory>("all");
  const [statusInput, setStatusInput] = useState<"all" | "applied" | "unapplied" | "updates">("all");

  // Applied filter state
  const [activeSearch, setActiveSearch] = useState("");
  const [activeSource, setActiveSource] = useState<PackageSource>("all");
  const [activeCategory, setActiveCategory] = useState<PackageCategory>("all");
  const [activeStatus, setActiveStatus] = useState<"all" | "applied" | "unapplied" | "updates">("all");

  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + Number(item.entry.fileSize), 0), [items]);
  const updatesCount = useMemo(
    () => items.filter(({ skin }) => updateStatuses[skin.id]?.updateAvailable).length,
    [items, updateStatuses]
  );

  // Unified list of all installed packages (Exist skins + RuneForge mods ONLY)
  // Regular custom skins (non-RuneForge) stay in Custom Skins and are excluded here per request!
  const allPackages = useMemo(() => {
    const list: Array<{
      key: string;
      id: string;
      name: string;
      subTitle: string;
      source: "exist" | "runeforge";
      sourceLabel: string;
      category: PackageCategory;
      categoryLabel: string;
      fileSize: number | bigint | null;
      dateStr: string;
      applied: boolean;
      hasUpdate: boolean;
      existSkin?: ExistSkin;
      existEntry?: InstalledExistSkin;
      localMod?: InstalledMod;
      thumbnailKey?: string | null;
    }> = [];

    const representedModIds = new Set<string>();

    for (const { skin, entry } of items) {
      representedModIds.add(entry.modId);
      list.push({
        key: `exist_${skin.id}`,
        id: skin.id,
        name: nameOf(skin),
        subTitle: skin.champion,
        source: "exist",
        sourceLabel: "Exist Library",
        category: "skin",
        categoryLabel: "Skin",
        fileSize: entry.fileSize,
        dateStr: entry.downloadedAt,
        applied: entry.applied,
        hasUpdate: Boolean(updateStatuses[skin.id]?.updateAvailable),
        existSkin: skin,
        existEntry: entry,
      });
    }

    for (const mod of localMods) {
      if (representedModIds.has(mod.id)) continue;
      // Exclude regular Custom Skins; ONLY include RuneForge downloads!
      if (!isRuneForgeMod(mod)) continue;

      const rfRecord = runeforgeRecords.find(
        (r) =>
          r.installedId?.toLowerCase() === mod.id.toLowerCase() ||
          r.modId?.toLowerCase() === mod.id.toLowerCase() ||
          r.name?.toLowerCase().trim() === mod.name.toLowerCase().trim() ||
          r.name?.toLowerCase().trim() === mod.displayName.toLowerCase().trim()
      );

      const text = `${mod.name} ${mod.displayName} ${mod.tags.join(" ")} ${mod.maps.join(" ")}`.toLowerCase();
      let category: PackageCategory = "other";
      let categoryLabel = "Mod";

      if (mod.maps.length > 0 || text.includes("map") || text.includes("rift") || text.includes("arena")) {
        category = "map";
        categoryLabel = "Map";
      } else if (text.includes("ui") || text.includes("hud") || text.includes("font") || text.includes("icon")) {
        category = "ui";
        categoryLabel = "UI / HUD";
      } else if (text.includes("sfx") || text.includes("sound") || text.includes("voice") || text.includes("audio")) {
        category = "sound";
        categoryLabel = "SFX";
      } else if (mod.champions.length > 0 || text.includes("skin") || text.includes("champion")) {
        category = "skin";
        categoryLabel = "Skin";
      }

      const subTitle =
        mod.champions.length > 0
          ? mod.champions.join(", ")
          : mod.maps.length > 0
          ? mod.maps.join(", ")
          : mod.authors[0] || mod.version || "RuneForge Mod";

      list.push({
        key: `runeforge_${mod.id}`,
        id: mod.id,
        name: mod.displayName || mod.name,
        subTitle,
        source: "runeforge",
        sourceLabel: "RuneForge",
        category,
        categoryLabel,
        fileSize: null,
        dateStr: mod.installedAt,
        applied: mod.enabled,
        hasUpdate: false,
        localMod: mod,
        thumbnailKey: rfRecord?.thumbnailKey ?? null,
      });
    }

    return list;
  }, [items, localMods, updateStatuses, isRuneForgeMod, runeforgeRecords]);

  function handleApplyFilter() {
    setActiveSearch(searchInput.trim());
    setActiveSource(sourceInput);
    setActiveCategory(categoryInput);
    setActiveStatus(statusInput);
  }

  function handleClearFilter() {
    setSearchInput("");
    setSourceInput("all");
    setCategoryInput("all");
    setStatusInput("all");
    setActiveSearch("");
    setActiveSource("all");
    setActiveCategory("all");
    setActiveStatus("all");
  }

  function handleQuickSource(src: PackageSource) {
    setSourceInput(src);
    setActiveSource(src);
  }

  function handleQuickCategory(cat: PackageCategory) {
    setCategoryInput(cat);
    setActiveCategory(cat);
  }

  const hasActiveFilters = Boolean(
    activeSearch || activeSource !== "all" || activeCategory !== "all" || activeStatus !== "all"
  );

  const filteredPackages = useMemo(() => {
    return allPackages.filter((pkg) => {
      // 1. Source filter (Exist Library vs RuneForge)
      if (activeSource !== "all" && pkg.source !== activeSource) {
        return false;
      }

      // 2. Category filter (Skin, Map, UI, SFX, Other)
      if (activeCategory !== "all" && pkg.category !== activeCategory) {
        return false;
      }

      // 3. Status filter
      if (activeStatus === "applied" && !pkg.applied) return false;
      if (activeStatus === "unapplied" && pkg.applied) return false;
      if (activeStatus === "updates" && !pkg.hasUpdate) return false;

      // 4. Search query filter
      if (activeSearch) {
        const needle = activeSearch.toLowerCase();
        const haystack = `${pkg.name} ${pkg.subTitle} ${pkg.categoryLabel} ${pkg.sourceLabel}`.toLowerCase();
        if (!haystack.includes(needle)) {
          if (pkg.localMod) {
            const extra = `${pkg.localMod.tags.join(" ")} ${pkg.localMod.champions.join(" ")} ${pkg.localMod.maps.join(" ")} ${pkg.localMod.authors.join(" ")}`.toLowerCase();
            if (!extra.includes(needle)) return false;
          } else {
            return false;
          }
        }
      }

      return true;
    });
  }, [allPackages, activeSource, activeCategory, activeStatus, activeSearch]);

  const sourceCounts = useMemo(() => {
    const counts = { all: allPackages.length, exist: 0, runeforge: 0 };
    for (const pkg of allPackages) {
      if (pkg.source === "exist") counts.exist += 1;
      else if (pkg.source === "runeforge") counts.runeforge += 1;
    }
    return counts;
  }, [allPackages]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      skin: 0,
      map: 0,
      ui: 0,
      sound: 0,
      other: 0,
    };
    for (const pkg of allPackages) {
      if (activeSource !== "all" && pkg.source !== activeSource) continue;
      counts.all += 1;
      counts[pkg.category] = (counts[pkg.category] || 0) + 1;
    }
    return counts;
  }, [allPackages, activeSource]);

  if (allPackages.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center text-center">
        <div className="max-w-md rounded-2xl border border-surface-800 bg-surface-900 p-8 shadow-xl">
          <h3 className="font-display text-2xl font-bold text-white">No cached skins or mods</h3>
          <p className="mt-2 text-xs text-surface-400 leading-relaxed">
            Browse the champion library or RuneForge to download and populate your local mod cache.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={onBrowse}
              className="rounded-full bg-accent-500 px-5 py-2.5 text-xs font-bold text-on-accent hover:bg-accent-400 transition-colors shadow-md shadow-accent-500/20 cursor-pointer"
            >
              Browse Champions
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Stats Overview */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-surface-800 bg-surface-900/60 p-4">
        <div>
          <span className="text-xs font-semibold text-surface-400">Total Installed Packages</span>
          <p className="font-display text-xl font-bold text-white mt-0.5">{allPackages.length} packages</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void onCheckUpdates()}
            disabled={checkingUpdates}
            className="flex items-center gap-2 rounded-xl border border-surface-700 bg-surface-800 px-3.5 py-2 text-xs font-bold text-surface-200 hover:border-surface-600 hover:bg-surface-750 transition-colors disabled:opacity-50 cursor-pointer"
            title="Check for skin updates"
          >
            <ArrowClockwiseIcon className={`h-4 w-4 ${checkingUpdates ? "animate-spin text-accent-400" : ""}`} />
            <span>{checkingUpdates ? "Checking updates…" : "Check for Updates"}</span>
          </button>

          {updatesCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-1 text-xs font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              {updatesCount} update{updatesCount > 1 ? "s" : ""} available
            </span>
          )}
        </div>

        <div className="text-right">
          <span className="text-xs font-semibold text-surface-400">Storage Footprint</span>
          <p className="font-mono text-xl font-bold text-accent-400 mt-0.5">{formatBytes(totalBytes)}</p>
        </div>
      </div>

      {/* Sleek Filtering Control Section - Non-overflowing flex layout */}
      <div className="rounded-2xl border border-surface-800 bg-surface-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400"
              size={16}
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApplyFilter();
              }}
              placeholder="Search by name, champion, map, or tags…"
              className="w-full rounded-xl border border-surface-700 bg-surface-950 py-2.5 pl-10 pr-4 text-xs text-white placeholder-surface-500 outline-none transition focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
            />
          </div>

          {/* Source Dropdown (Exist Library vs RuneForge) */}
          <div className="w-full sm:w-44 shrink-0">
            <select
              value={sourceInput}
              onChange={(e) => setSourceInput(e.target.value as PackageSource)}
              className="w-full rounded-xl border border-surface-700 bg-surface-950 px-3.5 py-2.5 text-xs text-surface-200 outline-none transition focus:border-accent-500 cursor-pointer"
            >
              <option value="all">All Sources</option>
              <option value="exist">Exist Library</option>
              <option value="runeforge">RuneForge</option>
            </select>
          </div>

          {/* Category Dropdown */}
          <div className="w-full sm:w-40 shrink-0">
            <select
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value as PackageCategory)}
              className="w-full rounded-xl border border-surface-700 bg-surface-950 px-3.5 py-2.5 text-xs text-surface-200 outline-none transition focus:border-accent-500 cursor-pointer"
            >
              <option value="all">All Categories</option>
              <option value="skin">Champion Skins</option>
              <option value="map">Maps & Arenas</option>
              <option value="ui">UI & HUD</option>
              <option value="sound">SFX & Audio</option>
              <option value="other">Other Content</option>
            </select>
          </div>

          {/* Status Dropdown */}
          <div className="w-full sm:w-36 shrink-0">
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value as any)}
              className="w-full rounded-xl border border-surface-700 bg-surface-950 px-3.5 py-2.5 text-xs text-surface-200 outline-none transition focus:border-accent-500 cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="applied">Applied / Active</option>
              <option value="unapplied">Inactive / Off</option>
              <option value="updates">Updates Available</option>
            </select>
          </div>

          {/* Filter Action Buttons - Always aligned with shrink-0, never overflow */}
          <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
            <button
              onClick={handleApplyFilter}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-accent-500 hover:bg-accent-400 active:bg-accent-600 px-4 py-2.5 text-xs font-bold text-on-accent transition-all shadow-md shadow-accent-500/20 cursor-pointer shrink-0"
            >
              <FunnelIcon weight="bold" size={14} />
              <span>Apply</span>
            </button>
            <button
              onClick={handleClearFilter}
              className="rounded-xl border border-surface-700 bg-surface-800 hover:bg-surface-700 active:bg-surface-850 px-3.5 py-2.5 text-xs font-semibold text-surface-300 hover:text-white transition-all cursor-pointer shrink-0"
              title="Clear all filters"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Quick Filter Pill Buttons & Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-surface-800/60 text-xs">
          <div className="flex items-center gap-2 text-surface-400">
            <span>
              Showing <strong className="text-white">{filteredPackages.length}</strong> of{" "}
              <strong className="text-white">{allPackages.length}</strong> installed items
            </span>
            {hasActiveFilters && (
              <span className="rounded-full bg-accent-500/10 border border-accent-500/30 px-2 py-0.5 text-[10px] font-bold text-accent-300">
                Filtered
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 overflow-x-auto py-0.5">
            {/* Quick Source Switcher */}
            <div className="flex items-center gap-1 rounded-lg border border-surface-800 bg-surface-950/80 p-0.5">
              {[
                { id: "all" as PackageSource, label: "All Sources", count: sourceCounts.all },
                { id: "exist" as PackageSource, label: "Exist", count: sourceCounts.exist },
                { id: "runeforge" as PackageSource, label: "RuneForge", count: sourceCounts.runeforge },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleQuickSource(s.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                    activeSource === s.id
                      ? "bg-accent-500 text-on-accent font-bold shadow-xs"
                      : "text-surface-400 hover:text-surface-200"
                  }`}
                >
                  {s.label} ({s.count})
                </button>
              ))}
            </div>

            {/* Quick Category Buttons */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {[
                { id: "all" as PackageCategory, label: "All", count: categoryCounts.all },
                { id: "skin" as PackageCategory, label: "Skins", count: categoryCounts.skin },
                { id: "map" as PackageCategory, label: "Maps", count: categoryCounts.map },
                { id: "ui" as PackageCategory, label: "UI / HUD", count: categoryCounts.ui },
                { id: "sound" as PackageCategory, label: "Audio", count: categoryCounts.sound },
                { id: "other" as PackageCategory, label: "Other", count: categoryCounts.other },
              ]
                .filter((c) => c.count > 0 || c.id === "all")
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleQuickCategory(c.id)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      activeCategory === c.id
                        ? "bg-accent-500 text-on-accent font-bold shadow-xs"
                        : "bg-surface-800/80 text-surface-400 hover:text-surface-200 hover:bg-surface-800"
                    }`}
                  >
                    {c.label} ({c.count})
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filtered Empty State */}
      {filteredPackages.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-surface-800 bg-surface-900/60 p-8 text-center">
          <ProhibitIcon size={36} className="text-surface-500 mb-2" />
          <h4 className="font-display text-lg font-bold text-white">No matching packages</h4>
          <p className="mt-1 text-xs text-surface-400 max-w-sm leading-relaxed">
            No installed packages match your current search and filter settings.
          </p>
          <button
            onClick={handleClearFilter}
            className="mt-4 rounded-xl border border-surface-700 bg-surface-800 px-4 py-2 text-xs font-semibold text-white hover:bg-surface-700 transition-colors cursor-pointer"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        /* Package Cards Grid */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 pb-12">
          {filteredPackages.map((pkg) => {
            const isUpdating = updatingSkinId === pkg.id;

            return (
              <article
                key={pkg.key}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border transition-all ${
                  pkg.applied
                    ? "border-success/50 bg-surface-900/90 shadow-md shadow-success/10"
                    : pkg.hasUpdate
                    ? "border-amber-500/50 bg-surface-900/90 shadow-md shadow-amber-500/10"
                    : "border-surface-800 bg-surface-900/80 hover:border-surface-700"
                }`}
              >
                {/* Artwork */}
                <div
                  onClick={() => {
                    if (pkg.existSkin) onInspect(pkg.existSkin);
                  }}
                  className={`relative h-32 w-full overflow-hidden bg-surface-950 ${
                    pkg.existSkin ? "cursor-pointer" : ""
                  }`}
                >
                  {pkg.existSkin ? (
                    <Artwork
                      skin={pkg.existSkin}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : pkg.localMod ? (
                    <LocalModArtwork mod={pkg.localMod} thumbnailKey={pkg.thumbnailKey} />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-transparent to-transparent" />

                  {/* Badges on Artwork */}
                  <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                    {pkg.applied && (
                      <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                        Applied
                      </span>
                    )}
                    <span className="rounded-full bg-surface-950/80 border border-surface-700 px-2 py-0.5 text-[9px] font-semibold text-accent-300 uppercase">
                      {pkg.categoryLabel}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase shadow-xs ${
                        pkg.source === "runeforge"
                          ? "bg-purple-900/80 border border-purple-500/50 text-purple-300"
                          : "bg-blue-900/80 border border-blue-500/50 text-blue-300"
                      }`}
                    >
                      {pkg.sourceLabel}
                    </span>
                  </div>

                  {pkg.hasUpdate && (
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold text-black shadow-md shadow-amber-500/30">
                      <ArrowClockwiseIcon weight="bold" className="h-3 w-3" />
                      Update Available
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[11px] font-semibold text-accent-400 uppercase tracking-wider truncate">
                        {pkg.subTitle}
                      </p>
                      {pkg.hasUpdate && (
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
                          New Version
                        </span>
                      )}
                    </div>
                    <h4
                      onClick={() => {
                        if (pkg.existSkin) onInspect(pkg.existSkin);
                      }}
                      className={`font-display text-sm font-bold text-white truncate mt-0.5 ${
                        pkg.existSkin ? "cursor-pointer hover:text-accent-300" : ""
                      }`}
                    >
                      {pkg.name}
                    </h4>
                    <p className="text-[11px] font-mono text-surface-500 mt-1">
                      {pkg.fileSize ? `${formatBytes(Number(pkg.fileSize))} · ` : ""}
                      {new Date(pkg.dateStr).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-col gap-2">
                    {pkg.hasUpdate && pkg.existSkin && (
                      <button
                        disabled={isPatcherActive || isUpdating || busy === pkg.id}
                        onClick={() => void onUpdate(pkg.existSkin!)}
                        className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 py-2 text-xs font-bold text-black transition-all shadow-md shadow-amber-500/20 disabled:opacity-50 cursor-pointer"
                        title="Update skin to latest version"
                      >
                        {isUpdating ? (
                          <>
                            <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" />
                            <span>Updating…</span>
                          </>
                        ) : (
                          <>
                            <ArrowClockwiseIcon weight="bold" className="h-3.5 w-3.5" />
                            <span>Update</span>
                          </>
                        )}
                      </button>
                    )}

                    <div className="flex gap-2">
                      {pkg.existSkin ? (
                        pkg.applied ? (
                          <button
                            disabled={isPatcherActive || busy === pkg.id || isUpdating}
                            onClick={() => void onUnapply(pkg.existSkin!)}
                            className="flex-1 rounded-xl border border-success/50 bg-success/20 py-2 text-xs font-bold text-success-text hover:bg-success/30 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            Unapply
                          </button>
                        ) : (
                          <button
                            disabled={isPatcherActive || busy === pkg.id || isUpdating}
                            onClick={() => void onApply(pkg.existSkin!)}
                            className="flex-1 rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent hover:bg-accent-400 transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
                          >
                            {busy === pkg.id ? "Applying…" : "Apply"}
                          </button>
                        )
                      ) : pkg.localMod ? (
                        <button
                          disabled={isPatcherActive}
                          onClick={() => void onToggleLocalMod(pkg.localMod!, !pkg.applied)}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer ${
                            pkg.applied
                              ? "border border-success/50 bg-success/20 text-success-text hover:bg-success/30"
                              : "bg-accent-500 text-on-accent hover:bg-accent-400 shadow-xs"
                          }`}
                        >
                          {pkg.applied ? "Disable" : "Enable"}
                        </button>
                      ) : null}

                      <button
                        disabled={isPatcherActive || busy === pkg.id || isUpdating}
                        onClick={() => {
                          if (pkg.existSkin) void onDelete(pkg.existSkin);
                          else if (pkg.localMod) void onUninstallLocalMod(pkg.localMod);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-surface-700 bg-surface-800 text-surface-400 hover:border-danger/40 hover:text-danger-text hover:bg-danger/10 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                        title="Delete from cache"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
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
      <div className={`flex items-center justify-center bg-surface-900 text-[10px] font-semibold tracking-[0.2em] text-surface-500 ${className}`}>
        NO ARTWORK
      </div>
    );
  }
  return <img loading="lazy" src={url} alt={`${mod.name} thumbnail`} className={`${className} object-cover`} onError={() => setFailed(true)} />;
}

function RuneForgeView({
  isPatcherActive = false,
  localMods = [],
  onRefreshLocalMods,
}: {
  isPatcherActive?: boolean;
  localMods?: InstalledMod[];
  onRefreshLocalMods?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [championId, setChampionId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [feature, setFeature] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RuneforgeMod | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const catalog = useRuneforgeCatalog({ page, pageSize: 24, search: deferredSearch || null, championId, category, theme, feature });
  const champions = useRuneforgeChampions();
  const totalPages = Math.max(1, Math.ceil((catalog.data?.total ?? 0) / 24));
  const categories = useMemo(() => filterValues(catalog.data?.mods.map((mod) => mod.category)), [catalog.data]);
  const themes = useMemo(() => filterValues(catalog.data?.mods.flatMap((mod) => mod.themes)), [catalog.data]);
  const features = useMemo(() => filterValues(catalog.data?.mods.flatMap((mod) => mod.features)), [catalog.data]);

  const installedModNames = useMemo(
    () => new Set(localMods.map((m) => m.displayName.toLowerCase().trim())),
    [localMods]
  );

  useEffect(() => {
    setPage(0);
  }, [deferredSearch, championId, category, theme, feature]);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-surface-800 bg-gradient-to-br from-surface-900 to-surface-950 p-6 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.22em] text-accent-400">PUBLIC CATALOG</p>
            <h3 className="mt-1 font-display text-2xl font-bold text-white">RuneForge</h3>
            <p className="mt-2 max-w-2xl text-sm text-surface-400">
              Browse and download custom champion skins, maps, HUDs, and sound mods from RuneForge directly into your library.
            </p>
          </div>
          <span className="rounded-full border border-surface-700 bg-surface-950 px-3 py-1 text-xs text-surface-400">
            {catalog.data ? `${catalog.data.total.toLocaleString()} mods` : "Loading catalog…"}
          </span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search RuneForge mods…"
              className="w-full rounded-xl border border-surface-700 bg-surface-950 py-2.5 pl-9 pr-3 text-sm text-white outline-none transition focus:border-accent-500"
            />
          </div>
          <select
            value={championId ?? ""}
            onChange={(event) => setChampionId(event.target.value ? Number(event.target.value) : null)}
            className="rounded-xl border border-surface-700 bg-surface-950 px-3 text-sm text-surface-200 outline-none focus:border-accent-500"
          >
            <option value="">All champions</option>
            {(champions.data?.champions ?? []).map((champion) => (
              <option key={champion.id} value={champion.id}>
                {champion.name}
              </option>
            ))}
          </select>
          <RuneForgeFilter label="Category" value={category} values={categories} onChange={setCategory} />
          <RuneForgeFilter label="Theme" value={theme} values={themes} onChange={setTheme} />
          <RuneForgeFilter label="Feature" value={feature} values={features} onChange={setFeature} />
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
            {catalog.data.mods.map((mod) => {
              const isInstalled = installedModNames.has(mod.name.toLowerCase().trim());

              return (
                <button
                  key={mod.id}
                  onClick={() => setSelected(mod)}
                  className="group overflow-hidden rounded-xl border border-surface-800 bg-surface-900 text-left transition hover:-translate-y-0.5 hover:border-accent-500/60 hover:bg-surface-800 cursor-pointer"
                >
                  <div className="relative">
                    <RuneForgeArtwork mod={mod} className="aspect-video w-full" />
                    {isInstalled && (
                      <span className="absolute top-2 right-2 rounded-full bg-success/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-success/30 flex items-center gap-1">
                        <CheckCircleIcon weight="fill" className="h-3 w-3" />
                        Installed
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="line-clamp-2 font-display text-base font-bold text-white">{mod.name}</h4>
                      {mod.status && (
                        <span className="shrink-0 rounded-full bg-surface-800 px-2 py-0.5 text-[10px] font-semibold text-surface-300">
                          {humanizeRuneForgeValue(mod.status)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-surface-400">by {mod.publisher?.username ?? "Unknown creator"}</p>
                    <p className="line-clamp-2 text-xs leading-relaxed text-surface-500">
                      {mod.description || "No public description."}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {mod.champions.slice(0, 2).map((champion) => (
                        <span key={champion.id} className="rounded bg-accent-500/10 px-1.5 py-0.5 text-[10px] text-accent-300">
                          {champion.name}
                        </span>
                      ))}
                      {mod.themes.slice(0, 2).map((theme) => (
                        <span key={theme} className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] text-surface-400">
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
              );
            })}
          </div>
          <div className="flex items-center justify-between rounded-xl border border-surface-800 bg-surface-900 px-4 py-3 text-sm">
            <span className="text-surface-400">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
                className="rounded-lg border border-surface-700 px-3 py-1.5 text-surface-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-800"
              >
                Previous
              </button>
              <button
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-lg border border-surface-700 px-3 py-1.5 text-surface-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <RuneForgeDetail
          mod={selected}
          isPatcherActive={isPatcherActive}
          isInstalled={installedModNames.has(selected.name.toLowerCase().trim())}
          onClose={() => setSelected(null)}
          onInstalled={onRefreshLocalMods}
        />
      )}
    </section>
  );
}

function RuneForgeDetail({
  mod,
  isPatcherActive,
  isInstalled,
  onClose,
  onInstalled,
}: {
  mod: RuneforgeMod;
  isPatcherActive: boolean;
  isInstalled: boolean;
  onClose: () => void;
  onInstalled?: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [installed, setInstalled] = useState(isInstalled);
  const toast = useToast();

  async function handleDownloadAndInstall() {
    if (isPatcherActive) {
      toast.warning("Patcher Active", "Please stop the patcher before installing mods.");
      return;
    }
    setDownloading(true);
    toast.info("Downloading RuneForge Mod", `Fetching and installing ${mod.name}…`);
    try {
      const result = await api.installRuneforgeMod(mod.id, mod.thumbnailKey);
      if (result.ok) {
        setInstalled(true);
        try {
          const raw = localStorage.getItem("exist_runeforge_installed_mods");
          const list: string[] = raw ? JSON.parse(raw) : [];
          const lowerId = mod.id.toLowerCase().trim();
          const lowerName = mod.name.toLowerCase().trim();
          if (!list.includes(lowerId)) list.push(lowerId);
          if (!list.includes(lowerName)) list.push(lowerName);
          if (result.value && typeof result.value === "object" && "Installed" in result.value) {
            const inst = (result.value as any).Installed;
            if (inst?.id && !list.includes(inst.id.toLowerCase().trim())) {
              list.push(inst.id.toLowerCase().trim());
            }
            if (inst?.name && !list.includes(inst.name.toLowerCase().trim())) {
              list.push(inst.name.toLowerCase().trim());
            }
          }
          localStorage.setItem("exist_runeforge_installed_mods", JSON.stringify(list));
        } catch {
          // ignore
        }
        toast.success(
          "Mod Installed",
          `${mod.name} was successfully downloaded and added to your active mod library!`
        );
        onInstalled?.();
      } else {
        toast.error("Download Failed", formatAppError(result.error));
      }
    } catch (err) {
      toast.error("Download Error", formatAppError(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5 backdrop-blur-md animate-in fade-in duration-200"
      onMouseDown={onClose}
    >
      <article
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-surface-700 bg-surface-950 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Modal Artwork */}
        <div className="relative">
          <RuneForgeArtwork mod={mod} className="aspect-[2/1] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-surface-950 via-transparent to-transparent" />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-black/70 p-2 text-white hover:bg-black transition-colors cursor-pointer"
            aria-label="Close"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Prominent Action Bar at the TOP */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-surface-800 bg-surface-900/60 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-500/10 px-2 py-0.5 text-[10px] font-bold text-accent-400 uppercase tracking-wider">
                  {humanizeRuneForgeValue(mod.category)}
                </span>
                {mod.status && (
                  <span className="rounded bg-surface-800 px-2 py-0.5 text-[10px] font-semibold text-surface-300">
                    {humanizeRuneForgeValue(mod.status)}
                  </span>
                )}
                {installed && (
                  <span className="flex items-center gap-1 rounded-full bg-success/20 border border-success/40 px-2 py-0.5 text-[10px] font-bold text-success-text">
                    <CheckCircleIcon weight="fill" className="h-3 w-3" />
                    Installed
                  </span>
                )}
              </div>
              <h3 className="mt-1 font-display text-2xl font-bold text-white truncate">{mod.name}</h3>
              <p className="text-xs text-surface-400 mt-0.5">by {mod.publisher?.username ?? "Unknown creator"}</p>
            </div>

            {/* Prominent Download Button at the top */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                disabled={isPatcherActive || downloading}
                onClick={handleDownloadAndInstall}
                className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-all shadow-lg cursor-pointer disabled:cursor-not-allowed ${
                  installed
                    ? "border border-success/40 bg-success/20 text-success-text hover:bg-success/30 shadow-success/10"
                    : "bg-accent-500 text-on-accent hover:bg-accent-400 active:bg-accent-600 shadow-accent-500/25"
                }`}
              >
                {downloading ? (
                  <>
                    <CircleNotchIcon className="h-4 w-4 animate-spin text-accent-400" />
                    <span>Installing Mod…</span>
                  </>
                ) : installed ? (
                  <>
                    <CheckCircleIcon weight="fill" className="h-4 w-4 text-success" />
                    <span>Reinstall Package</span>
                  </>
                ) : (
                  <>
                    <DownloadSimpleIcon weight="bold" className="h-4 w-4" />
                    <span>Download & Install</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Details Overview */}
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <DetailField label="Category" value={humanizeRuneForgeValue(mod.category)} />
            <DetailField label="Status" value={humanizeRuneForgeValue(mod.status)} />
            <DetailField label="Downloads" value={mod.downloadCount.toLocaleString()} />
          </div>

          {mod.champions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">Champions</p>
              <TagList values={mod.champions.map((champion) => champion.name)} />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">Themes</p>
            <TagList values={mod.themes.map(humanizeRuneForgeValue)} empty="No public themes" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">Features</p>
            <TagList values={mod.features.map(humanizeRuneForgeValue)} empty="No public features" />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-500">Description</p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-surface-300">
              {mod.description || "No public description."}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-surface-900 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">{label}</p><p className="mt-1 text-surface-200">{value}</p></div>; }
function TagList({ values, empty = "No public data" }: { values: string[]; empty?: string }) { return values.length ? <div className="flex flex-wrap gap-1.5">{values.map((value) => <span key={value} className="rounded-full bg-accent-500/10 px-2.5 py-1 text-xs text-accent-300">{value}</span>)}</div> : <p className="text-sm text-surface-500">{empty}</p>; }
function filterValues(values: Array<string | null | undefined> | undefined) { return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))].sort(); }
function RuneForgeFilter({ label, value, values, onChange }: { label: string; value: string | null; values: string[]; onChange: (value: string | null) => void }) { return <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className="rounded-xl border border-surface-700 bg-surface-950 px-3 text-sm text-surface-200 outline-none focus:border-accent-500"><option value="">All {label.toLowerCase()}s</option>{value && !values.includes(value) && <option value={value}>{humanizeRuneForgeValue(value)}</option>}{values.map((item) => <option key={item} value={item}>{humanizeRuneForgeValue(item)}</option>)}</select>; }

function CustomSkinsView({
  mods,
  importing,
  isPatcherActive,
  onImport,
  onToggle,
  onUninstall,
  runeforgeRecordByModId,
}: {
  mods: InstalledMod[];
  importing: boolean;
  isPatcherActive: boolean;
  onImport: () => Promise<void>;
  onToggle: (mod: InstalledMod, enabled: boolean) => Promise<void>;
  onUninstall: (mod: InstalledMod) => Promise<void>;
  runeforgeRecordByModId?: Map<string, RuneforgeInstalledRecord>;
}) {
  return <section>
    <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-surface-800 bg-surface-900/60 p-5">
      <div><p className="text-xs font-semibold tracking-wider text-surface-400">CUSTOM SKINS</p><h3 className="mt-1 font-display text-xl font-bold text-white">Your imported skins</h3><p className="mt-1 text-xs text-surface-500">Imported Fantome files use your configured LTK storage and active profile.</p></div>
      <button onClick={() => void onImport()} disabled={importing || isPatcherActive} className="shrink-0 rounded-full bg-accent-500 px-4 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50">{importing ? "Importing…" : "Import Skins"}</button>
    </div>
    {!mods.length ? <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-surface-800 bg-surface-900/40 text-center"><h3 className="font-display text-lg font-bold text-white">No custom skins yet</h3><p className="mt-2 max-w-sm text-xs text-surface-500">Import a Fantome skin to add it to the active LTK profile and patcher pipeline.</p></div> :
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 pb-12">
      {mods.map((mod) => <article key={mod.id} className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/80">
        <LocalModArtwork mod={mod} thumbnailKey={runeforgeRecordByModId?.get(mod.id.toLowerCase())?.thumbnailKey} />
        <div className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">{mod.champions.join(" · ") || "Local mod"}</p><h4 className="mt-0.5 truncate font-display text-sm font-bold text-white">{mod.displayName}</h4><p className="mt-1 text-[11px] text-surface-500">{mod.version || "No version"}{mod.authors[0] ? ` · ${mod.authors[0]}` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-1">{mod.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-surface-800 px-2 py-0.5 text-[10px] text-surface-400">{tag}</span>)}</div>
          <div className="mt-4 flex gap-2"><button disabled={isPatcherActive} onClick={() => void onToggle(mod, !mod.enabled)} className="flex-1 rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent disabled:opacity-50">{mod.enabled ? "Disable" : "Enable"}</button><button disabled={isPatcherActive} onClick={() => void onUninstall(mod)} className="rounded-xl border border-surface-700 px-3 text-xs font-semibold text-surface-300 disabled:opacity-50">Remove</button></div>
        </div>
      </article>)}
    </div>}
  </section>;
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
    const percent = item.totalBytes ? Math.round((item.downloadedBytes / item.totalBytes) * 100) : 0;

    return (
      <article
        key={task.skinId}
        className="flex items-center gap-4 rounded-2xl border border-surface-800 bg-surface-900/80 p-4"
      >
        <Artwork skin={skin} className="h-16 w-20 shrink-0 rounded-xl object-cover" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-sm font-bold text-white truncate">
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
              <div className="flex items-center justify-between text-[11px] font-mono text-surface-500">
                <span>{percent}% · {formatBytes(item.downloadedBytes)}{item.totalBytes && ` / ${formatBytes(item.totalBytes)}`}</span>
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
        <DownloadSimpleIcon size={40} className="text-surface-600 mb-3" />
        <h3 className="font-display text-lg text-white">No active downloads</h3>
        <p className="text-xs text-surface-400 mt-1">Downloads triggered from the library will appear here.</p>
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
        <div className="flex items-center gap-2 text-accent-400 text-xs font-bold tracking-widest uppercase">
          <SparkleIcon weight="fill" size={16} />
          Curated Catalog Highlights
        </div>
        <h3 className="font-display text-2xl font-bold text-white mt-1">Featured Community Fantomes</h3>
        <p className="text-xs text-surface-400 mt-1 max-w-xl">
          Deterministic featured selection with verified Fantome archives from the Finder repository.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 pb-12">
        {skins.map((skin) => {
          const entry = installedById.get(skin.id);

          return (
            <article
              key={skin.id}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/80 hover:border-surface-700 transition-all"
            >
              {/* Artwork */}
              <div
                onClick={() => onSelectSkin(skin)}
                className="relative h-36 w-full overflow-hidden bg-surface-950 cursor-pointer"
              >
                <Artwork skin={skin} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
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
                  <p className="text-[11px] font-semibold text-accent-400 uppercase tracking-wider">{skin.champion}</p>
                  <h4
                    onClick={() => onSelectSkin(skin)}
                    className="font-display text-sm font-bold text-white truncate cursor-pointer hover:text-accent-300 mt-0.5"
                  >
                    {nameOf(skin)}
                  </h4>
                  <p className="text-[11px] text-surface-500 mt-1">Skin ID #{skin.id}</p>
                </div>

                {/* Actions */}
                <div className="mt-4">
                  {entry?.applied ? (
                    <button
                      disabled={isPatcherActive || busy === skin.id}
                      onClick={() => void onUnapply(skin)}
                      className="w-full rounded-xl border border-success/50 bg-success/20 py-2 text-xs font-bold text-success-text hover:bg-success/30 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Unapply
                    </button>
                  ) : entry ? (
                    <button
                      disabled={isPatcherActive || busy === skin.id}
                      onClick={() => void onApply(skin)}
                      className="w-full rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent hover:bg-accent-400 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                    >
                      {busy === skin.id ? "Applying…" : "Apply"}
                    </button>
                  ) : (
                    <button
                      onClick={() => void onDownload(skin)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent-500 py-2 text-xs font-bold text-on-accent hover:bg-accent-400 transition-colors cursor-pointer shadow-xs"
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

