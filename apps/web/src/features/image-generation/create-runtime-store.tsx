"use client";

import {
  createContext,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";

type Listener = () => void;

type CreateRuntimeStore = {
  values: Map<string, unknown>;
  listeners: Map<string, Set<Listener>>;
};

const fallbackStore: CreateRuntimeStore = {
  values: new Map(),
  listeners: new Map(),
};

const CreateRuntimeContext = createContext<CreateRuntimeStore | null>(null);

function createStore(): CreateRuntimeStore {
  return {
    values: new Map(),
    listeners: new Map(),
  };
}

function resolveInitialValue<T>(initialValue: T | (() => T)): T {
  return typeof initialValue === "function"
    ? (initialValue as () => T)()
    : initialValue;
}

function notify(store: CreateRuntimeStore, key: string) {
  const listeners = store.listeners.get(key);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

export function CreateRuntimeProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<CreateRuntimeStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createStore();
  }

  return (
    <CreateRuntimeContext.Provider value={storeRef.current}>
      {children}
    </CreateRuntimeContext.Provider>
  );
}

export function useCreateRuntimeState<T>(
  key: string,
  initialValue: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const contextStore = useContext(CreateRuntimeContext);
  const store = contextStore || fallbackStore;

  if (!store.values.has(key)) {
    store.values.set(key, resolveInitialValue(initialValue));
  }

  const subscribe = useCallback(
    (listener: Listener) => {
      const listeners = store.listeners.get(key) || new Set<Listener>();
      listeners.add(listener);
      store.listeners.set(key, listeners);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          store.listeners.delete(key);
        }
      };
    },
    [key, store]
  );

  const getSnapshot = useCallback(
    () => store.values.get(key) as T,
    [key, store]
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      const previous = store.values.get(key) as T;
      const resolved =
        typeof nextValue === "function"
          ? (nextValue as (previousValue: T) => T)(previous)
          : nextValue;
      if (Object.is(previous, resolved)) return;
      store.values.set(key, resolved);
      notify(store, key);
    },
    [key, store]
  );

  return [value, setValue];
}

// 重置指定 key 的值,用于路由切换时清理创作页面的表单状态。
export function useResetCreateRuntimeKeys() {
  const contextStore = useContext(CreateRuntimeContext);
  const store = contextStore || fallbackStore;

  return useCallback(
    (keys: string[]) => {
      for (const key of keys) {
        if (store.values.has(key)) {
          store.values.delete(key);
          notify(store, key);
        }
      }
    },
    [store]
  );
}

export function useCreateRuntimeRef<T>(
  key: string,
  initialValue: T | (() => T)
): MutableRefObject<T> {
  const [ref] = useCreateRuntimeState<MutableRefObject<T>>(key, () => ({
    current: resolveInitialValue(initialValue),
  }));
  return ref;
}
