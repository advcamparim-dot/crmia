// Limitador de tentativas em memoria, por chave (ex.: IP).
//
// ATENCAO: o estado vive na memoria do processo. Vale para uma unica instancia do painel;
// com varias replicas (ou a cada restart) cada uma teria a propria contagem.

export interface LimitStatus {
  allowed: boolean;
  /** Milissegundos ate a chave poder tentar de novo (0 quando permitido). */
  retryAfterMs: number;
}

export interface LimiterOptions {
  /** Falhas dentro de windowMs que bloqueiam a chave. Padrao: 5. */
  max?: number;
  /** Janela em que as falhas contam. Padrao: 15 minutos. */
  windowMs?: number;
  /** Duracao do bloqueio. Padrao: 15 minutos. */
  lockMs?: number;
  /** Teto de chaves guardadas, para a memoria nao crescer sem limite. Padrao: 10.000. */
  maxKeys?: number;
  /** Relogio injetavel para testes. */
  now?: () => number;
}

export interface Limiter {
  /** Consulta sem contar tentativa. Chamar antes de comparar a senha. */
  check(key: string): LimitStatus;
  /** Registra uma falha. Ao atingir `max` na janela, bloqueia a chave por `lockMs`. */
  fail(key: string): LimitStatus;
  /** Login com sucesso: esquece a chave. */
  reset(key: string): void;
  /** Numero de chaves guardadas (diagnostico e testes). */
  size(): number;
}

interface Entry {
  /** Instantes das falhas que ainda podem estar dentro da janela. */
  failures: number[];
  /** Instante em que o bloqueio termina; 0 = nao bloqueada. */
  lockedUntil: number;
}

const MINUTE_MS = 60_000;

export function createLimiter(options: LimiterOptions = {}): Limiter {
  const max = options.max ?? 5;
  const windowMs = options.windowMs ?? 15 * MINUTE_MS;
  const lockMs = options.lockMs ?? 15 * MINUTE_MS;
  const maxKeys = options.maxKeys ?? 10_000;
  const now = options.now ?? Date.now;
  const sweepEveryMs = Math.min(windowMs, lockMs);

  const entries = new Map<string, Entry>();
  let lastSweep = now();

  const isLocked = (entry: Entry, t: number) => entry.lockedUntil > t;
  const inWindow = (failureAt: number, t: number) => t - failureAt < windowMs;

  function isStale(entry: Entry, t: number): boolean {
    return !isLocked(entry, t) && !entry.failures.some((f) => inWindow(f, t));
  }

  function sweep(t: number): void {
    lastSweep = t;
    entries.forEach((entry, key) => {
      if (isStale(entry, t)) entries.delete(key);
    });
  }

  function sweepIfDue(t: number): void {
    if (t - lastSweep >= sweepEveryMs) sweep(t);
  }

  // Abre espaco para uma chave nova respeitando maxKeys: varre expiradas e, se ainda
  // estiver cheio, descarta as mais antigas (preferindo as que nao estao bloqueadas).
  function makeRoom(t: number): void {
    if (entries.size < maxKeys) return;
    sweep(t);
    while (entries.size >= maxKeys) {
      const keys: string[] = [];
      entries.forEach((_entry, key) => keys.push(key));
      const victim = keys.find((key) => !isLocked(entries.get(key) as Entry, t)) ?? keys[0];
      if (victim === undefined) return;
      entries.delete(victim);
    }
  }

  function statusOf(entry: Entry | undefined, t: number): LimitStatus {
    if (entry && isLocked(entry, t)) return { allowed: false, retryAfterMs: entry.lockedUntil - t };
    return { allowed: true, retryAfterMs: 0 };
  }

  return {
    check(key) {
      const t = now();
      sweepIfDue(t);
      return statusOf(entries.get(key), t);
    },

    fail(key) {
      const t = now();
      sweepIfDue(t);
      let entry = entries.get(key);
      if (entry && isLocked(entry, t)) return statusOf(entry, t); // ja bloqueada: nao estende
      if (!entry) {
        makeRoom(t);
        entry = { failures: [], lockedUntil: 0 };
        entries.set(key, entry);
      }
      entry.lockedUntil = 0;
      entry.failures = entry.failures.filter((f) => inWindow(f, t));
      entry.failures.push(t);
      if (entry.failures.length >= max) {
        entry.failures = [];
        entry.lockedUntil = t + lockMs;
      }
      return statusOf(entry, t);
    },

    reset(key) {
      entries.delete(key);
    },

    size() {
      return entries.size;
    },
  };
}

const MAX_KEY_LENGTH = 64;

// Chave do cliente atras do proxy: primeira entrada de x-forwarded-for, depois x-real-ip,
// depois uma constante. O corte em 64 caracteres impede que um cabecalho gigante infle a memoria.
export function clientKeyFromHeaders(get: (name: string) => string | null | undefined): string {
  const forwarded = get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, MAX_KEY_LENGTH);
  const real = get('x-real-ip')?.trim();
  if (real) return real.slice(0, MAX_KEY_LENGTH);
  return 'desconhecido';
}
