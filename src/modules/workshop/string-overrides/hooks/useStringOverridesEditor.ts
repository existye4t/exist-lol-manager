import { useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
import type { StringKeySuggestion, WorkshopProject } from "@/lib/tauri";

import { useSaveStringOverrides } from "../../api/useSaveStringOverrides";
import { useProjectContext } from "../../components/ProjectContext";
import { serializeDraft, validateEntries } from "../draft";
import type { OverrideEntry, OverrideEntryField, OverrideSaveState } from "../types";

/* Long enough to batch a burst of composer commits, short enough that the
   work is on disk before the author thinks to wonder. */
const SAVE_DELAY_MS = 600;

function savedOverridesOf(
  project: WorkshopProject,
  layerName: string,
  locale: string,
): Record<string, string> {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.stringOverrides?.[locale] ?? {};
}

/**
 * The editable override list for one layer and locale, saving itself back.
 *
 * Every settled edit autosaves after a short debounce - there is no save
 * button to reach. A draft that fails validation holds the save and says so
 * through `saveState`, a failed write waits for a retry or the next edit,
 * and switching locale or closing the document flushes whatever the debounce
 * still held. The draft is reloaded when the layer or locale changes, not
 * when the project object does, so a background refetch cannot swallow
 * unsaved edits.
 */
export function useStringOverridesEditor(layerName: string, locale: string) {
  const project = useProjectContext();
  const toast = useToast();

  const [entries, setEntries] = useState<OverrideEntry[]>([]);
  /** What the project file holds, in {@link serializeDraft}'s shape. */
  const [saved, setSaved] = useState(() => serializeDraft([]));
  /** The draft a save rejected, so a hard failure retries once, not forever. */
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const [filter, setFilterState] = useState("");
  /* The row the composer last committed stays visible under an active filter
     it does not match, so a commit never looks like it vanished. */
  const [lastCommittedId, setLastCommittedId] = useState<string | null>(null);

  const errors = useMemo(() => validateEntries(entries), [entries]);
  const draft = serializeDraft(entries);

  const nextIdRef = useRef(0);
  const makeId = () => `ov-${nextIdRef.current++}`;

  const saveOverrides = useSaveStringOverrides();
  const isSaving = saveOverrides.isPending;

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  });

  function toEntries(localeOverrides: Record<string, string>): OverrideEntry[] {
    return Object.entries(localeOverrides).map(([key, value]) => ({ id: makeId(), key, value }));
  }

  useEffect(() => {
    const loaded = toEntries(savedOverridesOf(projectRef.current, layerName, locale));
    setEntries(loaded);
    setSaved(serializeDraft(loaded));
    setFailedDraft(null);
    setFilterState("");
    setLastCommittedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerName, locale, project.path]);

  function performSave() {
    const layer = project.layers.find((candidate) => candidate.name === layerName);
    if (!layer) return;

    const attempted = draft;

    const localeOverrides: Record<string, string> = {};
    for (const entry of entries) {
      const trimmedKey = entry.key.trim();
      if (trimmedKey) {
        localeOverrides[trimmedKey] = entry.value;
      }
    }

    const allOverrides: Record<string, Record<string, string>> = { ...layer.stringOverrides };

    if (Object.keys(localeOverrides).length > 0) {
      allOverrides[locale] = localeOverrides;
    } else {
      delete allOverrides[locale];
    }

    saveOverrides.mutate(
      { projectPath: project.path, layerName, stringOverrides: allOverrides },
      {
        onSuccess: () => {
          setSaved(attempted);
          setFailedDraft(null);
        },
        onError: (error) => {
          setFailedDraft(attempted);
          toast.error("Couldn't save the overrides", errorSummary(error));
        },
      },
    );
  }

  const hasErrors = Object.keys(errors).length > 0;
  const differs = draft !== saved;

  /* The timeout and the cleanup below fire these, and a ref keeps them from
     holding the render they were scheduled in. */
  const performSaveRef = useRef(performSave);
  const flushRef = useRef(() => {});
  useEffect(() => {
    performSaveRef.current = performSave;
    flushRef.current = () => {
      if (differs && !hasErrors && !isSaving) performSave();
    };
  });

  useEffect(() => {
    if (!differs || hasErrors || isSaving) return;
    /* A rejected draft schedules nothing more - retrying is `saveNow`'s, or
       the next edit's, to ask - so a hard failure cannot loop. */
    if (draft === failedDraft) return;

    const timer = setTimeout(() => performSaveRef.current(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [differs, hasErrors, isSaving, draft, failedDraft]);

  /* Whatever the debounce still holds goes to disk when this locale's editor
     ends - a switch to another locale, or the document closing. */
  useEffect(() => {
    return () => flushRef.current();
  }, [layerName, locale]);

  function saveNow() {
    if (differs && !hasErrors && !isSaving) performSave();
  }

  function saveStateOf(): OverrideSaveState {
    if (!differs) return "clean";
    if (isSaving) return "saving";
    if (hasErrors) return "blocked";
    if (draft === failedDraft) return "failed";
    return "pending";
  }

  function setFilter(next: string) {
    setFilterState(next);
    /* A new filter is a new question, so the fresh-row exemption lapses. */
    setLastCommittedId(null);
  }

  /** Add a row from the composer, or retarget the row that already holds the key. */
  function commitEntry(key: string, value: string) {
    const trimmed = key.trim();
    if (!trimmed) return;

    const existing = entries.find(
      (entry) => entry.key.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      setEntries((prev) =>
        prev.map((entry) => (entry.id === existing.id ? { ...entry, value } : entry)),
      );
      setLastCommittedId(existing.id);
      return;
    }

    /* Prepended, so the new row lands right under the composer. */
    const id = makeId();
    setEntries((prev) => [{ id, key: trimmed, value }, ...prev]);
    setLastCommittedId(id);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }

  function updateEntry(id: string, field: OverrideEntryField, value: string) {
    setEntries((prev) =>
      prev.map((candidate) => (candidate.id === id ? { ...candidate, [field]: value } : candidate)),
    );
  }

  function pickSuggestion(id: string, suggestion: StringKeySuggestion) {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== id) return entry;

        return {
          ...entry,
          key: suggestion.key,
          // Prefill the current in-game text so the author edits instead of
          // starting from scratch; never clobber a value they already typed.
          value: entry.value || (suggestion.value ?? ""),
        };
      }),
    );
  }

  return {
    entries,
    filter,
    setFilter,
    errors,
    lastCommittedId,
    saveState: saveStateOf(),
    saveNow,
    commitEntry,
    removeEntry,
    updateEntry,
    pickSuggestion,
  };
}
