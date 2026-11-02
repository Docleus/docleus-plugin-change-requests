import { useCallback, useEffect, useRef, useState } from "react";

export interface Loaded<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  reload(): void;
}

/** Runs `load` whenever `key` changes; results of superseded runs are dropped. */
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const latest = useRef(load);
  latest.current = load;
  const [state, setState] = useState<{ data?: T; error?: unknown }>({});
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    let isCurrent = true;
    latest.current().then(
      (data) => isCurrent && setState({ data }),
      (error: unknown) => isCurrent && setState({ error }),
    );
    return () => {
      isCurrent = false;
    };
  }, [key, generation]);
  return { data: state.data, error: state.error, reload };
}

/**
 * Runs one action at a time: `pending` names the running one, `error` holds
 * the last failure until the next run.
 */
export function useAction() {
  const [pending, setPending] = useState<string | undefined>();
  const [error, setError] = useState<unknown>();
  const run = useCallback(
    async (name: string, action: () => Promise<void>): Promise<boolean> => {
      setPending(name);
      setError(undefined);
      try {
        await action();
        return true;
      } catch (cause) {
        setError(cause);
        return false;
      } finally {
        setPending(undefined);
      }
    },
    [],
  );
  return { pending, error, run, setError };
}
