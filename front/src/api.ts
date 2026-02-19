const API = import.meta.env.VITE_API_URL;

export async function api<T>(
  path: string,
  opts: RequestInit = {},
  token?: string,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

export { API };
