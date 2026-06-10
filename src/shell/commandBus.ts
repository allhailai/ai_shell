/* ── Command Bus (Tier 2 Communication) ──────────────────────────────
   Framework-agnostic imperative command/event system.

   WHEN TO USE TIER 2:
   - "Make something happen" → Tier 2
   - One-off imperative actions: navigate, open a file, show toast
   - Module A telling Module B to DO something
   - Transient operations that don't need reactive subscriptions

   WHEN TO USE TIER 1 (Shell Store) INSTEAD:
   - "What is the current state?" → Tier 1
   - State that UI components subscribe to and re-render on

   PATTERNS:
   - invoke()  → request/response: caller awaits a result
   - emit()    → fire-and-forget: no result expected
   - on()      → subscribe to events/commands
   ──────────────────────────────────────────────────────────────────── */

type CommandHandler = (payload: unknown) => unknown | Promise<unknown>;
type EventListener = (payload: unknown) => void;

class CommandBus {
  private handlers = new Map<string, CommandHandler>();
  private listeners = new Map<string, Set<EventListener>>();

  /**
   * Register a command handler. Only one handler per command name.
   * Returns an unsubscribe function.
   */
  register(command: string, handler: CommandHandler): () => void {
    if (this.handlers.has(command)) {
      console.warn(`[CommandBus] Overwriting handler for "${command}"`);
    }
    this.handlers.set(command, handler);
    return () => {
      if (this.handlers.get(command) === handler) {
        this.handlers.delete(command);
      }
    };
  }

  /**
   * Invoke a command and await its result (request/response pattern).
   * Throws if no handler is registered.
   */
  async invoke<T = void>(command: string, payload?: unknown): Promise<T> {
    const handler = this.handlers.get(command);
    if (!handler) {
      throw new Error(`[CommandBus] No handler registered for "${command}"`);
    }
    const result = await handler(payload);
    return result as T;
  }

  /**
   * Fire-and-forget broadcast. Notifies all listeners for the event.
   * Does not require a handler — this is purely for broadcasting.
   */
  emit(event: string, payload?: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch (err) {
          console.error(`[CommandBus] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * Multiple listeners per event are supported.
   */
  on(event: string, listener: EventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /** List all registered command names (useful for debugging). */
  listCommands(): string[] {
    return [...this.handlers.keys()];
  }

  /** List all event names with active listeners (useful for debugging). */
  listEvents(): string[] {
    return [...this.listeners.keys()];
  }
}

/** Singleton command bus instance. */
export const commandBus = new CommandBus();

// Expose on window for framework-agnostic access and debugging.
declare global {
  interface Window {
    __aiShell?: {
      commandBus: CommandBus;
    };
  }
}

if (typeof window !== "undefined") {
  window.__aiShell = { commandBus };
}
