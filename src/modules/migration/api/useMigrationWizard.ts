import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { errorSummary } from "@/i18n";
import type { BulkInstallResult, CslolModInfo } from "@/lib/tauri";

import { useImportCslolMods } from "./useImportCslolMods";
import { useMigrationProgress } from "./useMigrationProgress";
import { useScanCslolMods } from "./useScanCslolMods";

export type WizardStep = "browse" | "select" | "importing" | "results";

export function useMigrationWizard(onClose: () => void) {
  const [step, setStep] = useState<WizardStep>("browse");
  const [directory, setDirectory] = useState("");
  const [mods, setMods] = useState<CslolModInfo[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<BulkInstallResult | null>(null);

  const scanMods = useScanCslolMods();
  const importMods = useImportCslolMods();
  const { progress, reset: resetProgress } = useMigrationProgress();

  function reset() {
    setStep("browse");
    setDirectory("");
    setMods([]);
    setSelectedFolders(new Set());
    setImportResult(null);
    resetProgress();
  }

  function handleClose() {
    if (step === "importing") return;
    reset();
    onClose();
  }

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      title: "Select cslol-manager Directory",
    });

    if (!selected) return;
    const dir = selected as string;
    setDirectory(dir);

    scanMods.mutate(dir, {
      onSuccess: (discovered) => {
        setMods(discovered);
        setSelectedFolders(new Set(discovered.map((m) => m.folderName)));
        setStep("select");
      },
    });
  }

  function handleToggleMod(folderName: string) {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  }

  function handleSelectAll() {
    setSelectedFolders(new Set(mods.map((m) => m.folderName)));
  }

  function handleSelectNone() {
    setSelectedFolders(new Set());
  }

  function handleImport() {
    setImportResult(null);
    resetProgress();
    setStep("importing");

    importMods.mutate(
      { directory, selectedFolders: Array.from(selectedFolders) },
      {
        onSuccess: (result) => {
          setImportResult(result);
          setStep("results");
        },
        onError: () => {
          setStep("select");
        },
      },
    );
  }

  return {
    step,
    setStep,
    mods,
    selectedFolders,
    importResult,
    progress,
    scanError: scanMods.error ? errorSummary(scanMods.error) : undefined,
    isScanning: scanMods.isPending,
    handleClose,
    handleBrowse,
    handleToggleMod,
    handleSelectAll,
    handleSelectNone,
    handleImport,
  };
}
