type AccessStats = {
  email: string;
  accesses: number;
  lastAccessAt: string | null;
  firstAccessAt: string | null;
};

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return { url, token };
}

function isRedisConfigured(): boolean {
  const { url, token } = getRedisConfig();
  return Boolean(url && token);
}

async function redisPipeline(commands: string[][]): Promise<Array<{ result?: unknown; error?: string }>> {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL o UPSTASH_REDIS_REST_TOKEN non configurate.");
  }

  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Errore Redis access log: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(payload)) {
    throw new Error("Risposta Redis non valida.");
  }
  for (const entry of payload) {
    if (entry.error) {
      throw new Error(`Errore Redis access log: ${entry.error}`);
    }
  }
  return payload;
}

export async function registerUserAccess(email: string): Promise<void> {
  if (!isRedisConfigured()) return;

  const normalizedEmail = email.trim().toLowerCase();
  const key = `access:user:${normalizedEmail}`;
  const now = new Date().toISOString();

  await redisPipeline([
    ["HSETNX", key, "firstAccessAt", now],
    ["HINCRBY", key, "accesses", "1"],
    ["HSET", key, "lastAccessAt", now],
    ["HSET", key, "email", normalizedEmail],
  ]);
}

export async function getUserAccessStats(email: string): Promise<AccessStats> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isRedisConfigured()) {
    return {
      email: normalizedEmail,
      accesses: 0,
      lastAccessAt: null,
      firstAccessAt: null,
    };
  }

  const key = `access:user:${normalizedEmail}`;
  const payload = await redisPipeline([["HMGET", key, "accesses", "lastAccessAt", "firstAccessAt"]]);
  const row = payload[0]?.result as [unknown, unknown, unknown] | undefined;

  const accesses = Math.max(0, Number(row?.[0] ?? 0) || 0);
  const lastAccessAt = typeof row?.[1] === "string" && row[1].trim().length > 0 ? row[1] : null;
  const firstAccessAt = typeof row?.[2] === "string" && row[2].trim().length > 0 ? row[2] : null;

  return {
    email: normalizedEmail,
    accesses,
    lastAccessAt,
    firstAccessAt,
  };
}

export type { AccessStats };

