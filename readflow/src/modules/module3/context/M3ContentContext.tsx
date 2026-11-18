import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { getPublishedStudentModules } from "../state/studentModuleState";
import {
  archiveModule as archivePersistedModule,
  createModule as createPersistedModule,
  deleteModule as deletePersistedModule,
  getLearningPaths,
  getModuleById,
  getModuleErrorMessage,
  getModules,
  publishModule as publishPersistedModule,
  restoreModule as restorePersistedModule,
  unpublishModule as unpublishPersistedModule,
  updateModule as updatePersistedModule,
} from "../services/moduleService";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../../lib/supabaseClient";
import type { ProposedPassageDatabase } from "../types/proposedPassageDatabase";
import { createModulePassageRepository } from "../services/modulePassageService";
import { loadStudentModuleDetail, type StudentModuleDetail } from "../services/studentModuleDetail";
import {
  deleteMaterial as deletePersistedMaterial,
  getMaterialServiceError,
  getMaterials,
} from "../services/materialService";
import type {
  LearningPath,
  M3Feedback,
  M3ModuleMutationResult,
  UploadedMaterial,
  ModuleFormValues,
  ModuleStatus,
  ReadingModule,
  StudentReadingModule,
} from "../types/content";

interface M3ContentContextValue {
  modules: ReadingModule[];
  modulesLoading: boolean;
  modulesError: string | null;
  learningPaths: LearningPath[];
  learningPathsLoading: boolean;
  learningPathsError: string | null;
  studentModules: StudentReadingModule[];
  materials: UploadedMaterial[];
  materialsLoading: boolean;
  materialsError: string | null;
  feedback: M3Feedback | null;
  clearFeedback: () => void;
  refreshModules: () => Promise<void>;
  refreshMaterials: () => Promise<void>;
  getModule: (moduleId: string | undefined) => ReadingModule | undefined;
  getStudentModule: (moduleId: string | undefined) => Promise<StudentModuleDetail | undefined>;
  getMaterial: (materialId: string | undefined) => UploadedMaterial | undefined;
  removeMaterial: (materialId: string) => Promise<void>;
  createModule: (values: ModuleFormValues) => Promise<M3ModuleMutationResult>;
  updateModule: (
    moduleId: string,
    values: ModuleFormValues,
  ) => Promise<M3ModuleMutationResult>;
  publishModule: (moduleId: string) => Promise<M3ModuleMutationResult>;
  unpublishModule: (moduleId: string) => Promise<M3ModuleMutationResult>;
  archiveModule: (moduleId: string) => Promise<M3ModuleMutationResult>;
  restoreModule: (moduleId: string) => Promise<M3ModuleMutationResult>;
  deleteModule: (moduleId: string) => Promise<M3ModuleMutationResult>;
}

interface M3ContentProviderProps {
  children: ReactNode;
}

// One module status transition: which statuses may start it, how to persist it,
// and the exact messages shown for refusal, success and failure.
interface ModuleStatusChange {
  guard: (status: ModuleStatus) => boolean;
  guardMessage: string;
  persist: (moduleId: string) => Promise<ReadingModule>;
  successMessage: (module: ReadingModule) => string;
  fallback: string;
}

const M3ContentContext = createContext<M3ContentContextValue | null>(null);
const learnerPassages = createModulePassageRepository(supabase as unknown as SupabaseClient<ProposedPassageDatabase>);

function replaceModule(modules: ReadingModule[], updatedModule: ReadingModule) {
  return modules.map((module) =>
    module.id === updatedModule.id ? updatedModule : module,
  );
}

export function M3ContentProvider({ children }: M3ContentProviderProps) {
  const { pathname } = useLocation();
  const materialWorkspace = pathname.match(/^(?:\/m3\/(admin|teacher|general)|\/system-admin\/content)(?=\/|$)/)?.[0] ?? "";
  const [modules, setModules] = useState<ReadingModule[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [learningPaths, setLearningPaths] = useState<LearningPath[]>([]);
  const [learningPathsLoading, setLearningPathsLoading] = useState(true);
  const [learningPathsError, setLearningPathsError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<UploadedMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<M3Feedback | null>(null);

  const refreshModules = useCallback(async () => {
    setModulesLoading(true);
    setModulesError(null);

    try {
      setModules(await getModules());
    } catch (error) {
      setModules([]);
      setModulesError(getModuleErrorMessage(error, "Unable to load reading modules."));
    } finally {
      setModulesLoading(false);
    }
  }, []);

  const refreshLearningPaths = useCallback(async () => {
    setLearningPathsLoading(true);
    setLearningPathsError(null);

    try {
      setLearningPaths(await getLearningPaths());
    } catch (error) {
      setLearningPaths([]);
      setLearningPathsError(getModuleErrorMessage(error, "Unable to load learning paths."));
    } finally {
      setLearningPathsLoading(false);
    }
  }, []);

  const refreshMaterials = useCallback(async () => {
    setMaterialsLoading(true);
    setMaterialsError(null);
    try {
      setMaterials(await getMaterials());
    } catch (error) {
      setMaterials([]);
      setMaterialsError(getMaterialServiceError(error, "Unable to load uploaded materials."));
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshModules();
    void refreshLearningPaths();
  }, [refreshLearningPaths, refreshModules]);

  useEffect(() => {
    if (materialWorkspace) {
      void refreshMaterials();
    } else {
      setMaterialsLoading(false);
    }
  }, [materialWorkspace, refreshMaterials]);

  const studentModules = useMemo(
    () => getPublishedStudentModules(modules),
    [modules],
  );

  const mutationFailure = useCallback(
    (error: unknown, fallback: string): M3ModuleMutationResult => {
      const message = getModuleErrorMessage(error, fallback);
      setFeedback({ kind: "error", message });
      return { ok: false, message };
    },
    [],
  );

  const createModule = useCallback(
    async (values: ModuleFormValues): Promise<M3ModuleMutationResult> => {
      if (!learningPaths.some((path) => path.id === values.learningPathId)) {
        return mutationFailure(undefined, "Select a valid learning path before saving.");
      }

      try {
        const module = await createPersistedModule(values);
        setModules((current) => [module, ...current.filter((item) => item.id !== module.id)]);
        const message = `${module.title} was created as a draft.`;
        setFeedback({ kind: "success", message });
        return { ok: true, module, message };
      } catch (error) {
        return mutationFailure(error, "Unable to create the reading module.");
      }
    },
    [learningPaths, mutationFailure],
  );

  const updateModule = useCallback(
    async (
      moduleId: string,
      values: ModuleFormValues,
    ): Promise<M3ModuleMutationResult> => {
      if (!learningPaths.some((path) => path.id === values.learningPathId)) {
        return mutationFailure(undefined, "Select a valid learning path before saving.");
      }

      try {
        const module = await updatePersistedModule(moduleId, values);
        setModules((current) => replaceModule(current, module));
        const message = `${module.title} was updated.`;
        setFeedback({ kind: "success", message });
        return { ok: true, module, message };
      } catch (error) {
        return mutationFailure(error, "Unable to update the reading module.");
      }
    },
    [learningPaths, mutationFailure],
  );

  const changeModuleStatus = useCallback(
    async (
      moduleId: string,
      { guard, guardMessage, persist, successMessage, fallback }: ModuleStatusChange,
    ): Promise<M3ModuleMutationResult> => {
      const currentModule = modules.find((module) => module.id === moduleId);
      if (!currentModule || !guard(currentModule.status)) {
        return mutationFailure(undefined, guardMessage);
      }

      try {
        const module = await persist(moduleId);
        setModules((current) => replaceModule(current, module));
        const message = successMessage(module);
        setFeedback({ kind: "success", message });
        return { ok: true, module, message };
      } catch (error) {
        return mutationFailure(error, fallback);
      }
    },
    [modules, mutationFailure],
  );

  const publishModule = useCallback(
    (moduleId: string) => changeModuleStatus(moduleId, {
      guard: (status) => status === "draft",
      guardMessage: "Only draft modules can be published.",
      persist: publishPersistedModule,
      successMessage: (module) => `${module.title} was published and is now visible in published catalogs.`,
      fallback: "Unable to publish the reading module.",
    }),
    [changeModuleStatus],
  );

  const unpublishModule = useCallback(
    (moduleId: string) => changeModuleStatus(moduleId, {
      guard: (status) => status === "published",
      guardMessage: "Only published modules can be unpublished.",
      persist: unpublishPersistedModule,
      successMessage: (module) => `${module.title} was unpublished and returned to Draft.`,
      fallback: "Unable to unpublish the reading module.",
    }),
    [changeModuleStatus],
  );

  const archiveModule = useCallback(
    (moduleId: string) => changeModuleStatus(moduleId, {
      guard: (status) => status !== "archived",
      guardMessage: "This module is already archived or unavailable.",
      persist: archivePersistedModule,
      successMessage: (module) => `${module.title} was archived.`,
      fallback: "Unable to archive the reading module.",
    }),
    [changeModuleStatus],
  );

  const restoreModule = useCallback(
    (moduleId: string) => changeModuleStatus(moduleId, {
      guard: (status) => status === "archived",
      guardMessage: "Only archived modules can be restored.",
      persist: restorePersistedModule,
      successMessage: (module) => `${module.title} was restored as a draft.`,
      fallback: "Unable to restore the reading module.",
    }),
    [changeModuleStatus],
  );

  const deleteModule = useCallback(
    async (moduleId: string): Promise<M3ModuleMutationResult> => {
      const currentModule = modules.find((module) => module.id === moduleId);
      if (!currentModule) return mutationFailure(undefined, "This module is no longer in the loaded list. Refresh the list before deleting.");
      // The service checks current database state and returns the specific blocker.

      try {
        const outcome = await deletePersistedModule(moduleId);
        setModules((current) => current.filter((module) => module.id !== moduleId));
        const message = outcome === "soft" ? `${currentModule.title} was removed from active catalogs. Existing assignments and reading history were preserved.` : `${currentModule.title} was permanently deleted.`;
        setFeedback({ kind: "success", message });
        return { ok: true, module: currentModule, message };
      } catch (error) {
        return mutationFailure(error, "Unable to delete the reading module.");
      }
    },
    [modules, mutationFailure],
  );

  const getModule = useCallback(
    (moduleId: string | undefined) => modules.find((module) => module.id === moduleId),
    [modules],
  );

  const getStudentModule = useCallback(async (moduleId: string | undefined) => {
    return loadStudentModuleDetail(moduleId, {
      getModuleById,
      getPassages: learnerPassages.getPassages,
    });
  }, []);

  const getMaterial = useCallback(
    (materialId: string | undefined) =>
      materials.find((material) => material.id === materialId),
    [materials],
  );

  const removeMaterial = useCallback(async (materialId: string) => {
    await deletePersistedMaterial(materialId);
    setMaterials((current) => current.filter((material) => material.id !== materialId));

  }, []);

  const value = useMemo<M3ContentContextValue>(
    () => ({
      modules,
      modulesLoading,
      modulesError,
      learningPaths,
      learningPathsLoading,
      learningPathsError,
      studentModules,
      materials,
      materialsLoading,
      materialsError,
      feedback,
      clearFeedback: () => setFeedback(null),
      refreshModules,
      refreshMaterials,
      getModule,
      getStudentModule,
      getMaterial,
      removeMaterial,
      createModule,
      updateModule,
      publishModule,
      unpublishModule,
      archiveModule,
      restoreModule,
      deleteModule,
    }),
    [
      archiveModule,
      createModule,
      deleteModule,
      feedback,
      getMaterial,
      getModule,
      getStudentModule,
      learningPaths,
      learningPathsError,
      learningPathsLoading,
      materials,
      materialsError,
      materialsLoading,
      modules,
      modulesError,
      modulesLoading,
      publishModule,
      refreshModules,
      refreshMaterials,
      removeMaterial,
      restoreModule,
      studentModules,
      unpublishModule,
      updateModule,
    ],
  );

  return <M3ContentContext.Provider value={value}>{children}</M3ContentContext.Provider>;
}

export function useM3Content() {
  const context = useContext(M3ContentContext);

  if (!context) {
    throw new Error("useM3Content must be used within M3ContentProvider.");
  }

  return context;
}
