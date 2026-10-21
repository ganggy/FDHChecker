export interface EclaimForegroundStatus {
  isWorking: boolean;
  progress: number;
  currentStep: string | null;
  currentFile: string | null;
  totalFiles: number;
  newFilesCount: number;
  downloadedCount: number;
  importedCount: number;
  alreadyCount: number;
  errorCount: number;
  periodText: string | null;
  isModalOpen: boolean;
  completed: boolean;
}

type Listener = (status: EclaimForegroundStatus) => void;

let currentStatus: EclaimForegroundStatus = {
  isWorking: false,
  progress: 0,
  currentStep: null,
  currentFile: null,
  totalFiles: 0,
  newFilesCount: 0,
  downloadedCount: 0,
  importedCount: 0,
  alreadyCount: 0,
  errorCount: 0,
  periodText: null,
  isModalOpen: false,
  completed: false,
};

const listeners = new Set<Listener>();

export const eclaimGlobalSyncState = {
  get: (): EclaimForegroundStatus => currentStatus,
  set: (update: Partial<EclaimForegroundStatus>) => {
    let changed = false;
    for (const key of Object.keys(update) as Array<keyof EclaimForegroundStatus>) {
      if (currentStatus[key] !== update[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    currentStatus = { ...currentStatus, ...update };
    listeners.forEach((l) => {
      try { l(currentStatus); } catch { /* ignore listener error */ }
    });
  },
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  toggleModal: () => {
    currentStatus = { ...currentStatus, isModalOpen: !currentStatus.isModalOpen };
    listeners.forEach((l) => {
      try { l(currentStatus); } catch { /* ignore */ }
    });
  },
  openModal: () => {
    currentStatus = { ...currentStatus, isModalOpen: true };
    listeners.forEach((l) => {
      try { l(currentStatus); } catch { /* ignore */ }
    });
  },
  closeModal: () => {
    currentStatus = { ...currentStatus, isModalOpen: false };
    listeners.forEach((l) => {
      try { l(currentStatus); } catch { /* ignore */ }
    });
  },
};
