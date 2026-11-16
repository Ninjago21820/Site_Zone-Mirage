import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, ApiError } from './api';

export interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T = any>(path: string | null, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((result) => {
        if (alive.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (alive.current) setError(err instanceof ApiError ? err : new ApiError(0, 'network', 'Erreur réseau.'));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  const reload = useCallback(() => setTick((v) => v + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
