type QuotaCheckResult = {
  allowed: boolean;
  current: number;
  limit: number;
  weekKey: string;
};

function readOptionalNumber(name: string): number {
  const raw = process.env[name]?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function getWeekStartUtc(date = new Date()): Date {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - day + 1);
  utcDate.setUTCHours(0, 0, 0, 0);
  return utcDate;
}

function getIsoWeekKey(date = new Date()): string {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function secondsUntilNextWeek(): number {
  const now = new Date();
  const start = getWeekStartUtc(now);
  const next = new Date(start);
  next.setUTCDate(start.getUTCDate() + 7);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return { url, token };
}

export function getWeeklyQuestionLimit(): number {
  return readOptionalNumber("WEEKLY_QUESTION_LIMIT");
}

async function redisCommand(command: string[]): Promise<unknown> {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    throw new Error(
      "Quota settimanale abilitata ma mancano UPSTASH_REDIS_REST_URL o UPSTASH_REDIS_REST_TOKEN.",
    );
  }

  const endpoint = `${url}/pipeline`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Errore Redis quota: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("Risposta Redis non valida.");
  }
  if (payload[0].error) {
    throw new Error(`Errore Redis quota: ${payload[0].error}`);
  }
  return payload[0].result;
}

export async function registerQuestionUsage(email: string, limit: number): Promise<QuotaCheckResult> {
  if (limit <= 0) {
    return {
      allowed: true,
      current: 0,
      limit: 0,
      weekKey: getIsoWeekKey(),
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const weekKey = getIsoWeekKey();
  const redisKey = `quota:weekly:${weekKey}:${normalizedEmail}`;

  const incrementResult = await redisCommand(["INCR", redisKey]);
  const current = Number(incrementResult ?? 0);
  if (!Number.isFinite(current) || current < 1) {
    throw new Error("Contatore quota non valido.");
  }

  if (current === 1) {
    await redisCommand(["EXPIRE", redisKey, String(secondsUntilNextWeek())]);
  }

  return {
    allowed: current <= limit,
    current,
    limit,
    weekKey,
  };
}

