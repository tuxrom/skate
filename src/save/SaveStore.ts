/** Base IndexedDB, magasin d'objets et clé de l'unique enregistrement. */
const DB_NAME = 'skate';
const DB_STORE = 'save';
const DB_KEY = 'profile';
/** Clé du repli localStorage. */
const LOCAL_KEY = 'skate.save.v1';
/** Ancienne clé des records (étape 7), reprise une fois si aucune sauvegarde n'existe. */
const LEGACY_SCORES_KEY = 'skate.scores.v1';
/** Délai max d'ouverture d'IndexedDB avant de passer au localStorage (ms). */
const OPEN_TIMEOUT_MS = 2000;

export type SaveBackendName = 'indexeddb' | 'localstorage' | 'none';

interface Backend {
  readonly name: SaveBackendName;
  read(): Promise<unknown>;
  write(data: unknown): Promise<void>;
}

/**
 * Sauvegarde persistante : IndexedDB, avec repli sur le localStorage si IndexedDB est absent ou
 * refuse de s'ouvrir (navigation privée, stockage bloqué). Sans l'un ni l'autre, la partie se joue
 * sans sauvegarde. Le contenu est lu brut : à valider avec sanitizeSave.
 */
export class SaveStore {
  private constructor(private readonly backend: Backend) {}

  /** Ouvre le meilleur stockage disponible. */
  static async open(): Promise<SaveStore> {
    const idb = await openIndexedDb();
    if (idb) return new SaveStore(idb);
    if (localStorageWorks()) return new SaveStore(localBackend);
    return new SaveStore(noneBackend);
  }

  get backendName(): SaveBackendName {
    return this.backend.name;
  }

  /** Données sauvegardées, ou anciennes données à reprendre, ou null. */
  async load(): Promise<unknown> {
    try {
      const data = await this.backend.read();
      if (data !== undefined && data !== null) return data;
    } catch {
      // Lecture impossible : on tente les autres sources.
    }
    // Sauvegarde laissée par un repli localStorage antérieur.
    const local = readLocal(LOCAL_KEY);
    if (local !== null) return local;
    const legacy = readLocal(LEGACY_SCORES_KEY);
    if (legacy !== null) return { records: legacy };
    return null;
  }

  /** Renvoie faux si l'écriture a échoué ; on retente alors au localStorage. */
  async save(data: unknown): Promise<boolean> {
    try {
      await this.backend.write(data);
      return true;
    } catch {
      if (this.backend !== localBackend && localStorageWorks()) {
        try {
          await localBackend.write(data);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }
}

function openIndexedDb(): Promise<Backend | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (b: Backend | null) => {
      if (settled) return;
      settled = true;
      resolve(b);
    };
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      clearTimeout(timer);
      done(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    req.onblocked = () => {
      clearTimeout(timer);
      done(null);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      done(idbBackend(db));
    };
  });
}

function idbBackend(db: IDBDatabase): Backend {
  const run = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = op(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB'));
    });
  return {
    name: 'indexeddb',
    read: () => run('readonly', (s) => s.get(DB_KEY)),
    write: async (data) => {
      await run('readwrite', (s) => s.put(data, DB_KEY));
    },
  };
}

const localBackend: Backend = {
  name: 'localstorage',
  read: async () => readLocal(LOCAL_KEY),
  write: async (data) => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  },
};

const noneBackend: Backend = {
  name: 'none',
  read: async () => null,
  write: async () => {
    throw new Error('Aucun stockage disponible');
  },
};

function localStorageWorks(): boolean {
  try {
    const k = '__skate_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readLocal(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
