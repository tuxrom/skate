/** Écouteur d'un type d'événement. */
export type Listener<T> = (payload: T) => void;

/**
 * Bus d'événements typé : `E` associe à chaque nom d'événement le type de sa charge.
 *
 * Les émetteurs du jeu réutilisent leurs objets de charge d'un événement à l'autre (pas d'allocation
 * dans la boucle) : un écouteur qui veut garder une valeur doit la copier.
 * Les écouteurs sont appelés dans l'ordre d'abonnement ; un désabonnement pendant une émission
 * prend effet tout de suite, sans sauter les écouteurs suivants.
 */
export class EventBus<E extends { [K in keyof E]: unknown }> {
  private readonly listeners: { [K in keyof E]?: (Listener<E[K]> | null)[] } = {};
  private emitting = 0;
  private dirty = false;

  /** Abonne `fn` à `type`. Renvoie la fonction de désabonnement. */
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let list = this.listeners[type];
    if (!list) {
      list = [];
      this.listeners[type] = list;
    }
    list.push(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof E>(type: K, fn: Listener<E[K]>): void {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i < 0) return;
    if (this.emitting > 0) {
      list[i] = null;
      this.dirty = true;
    } else {
      list.splice(i, 1);
    }
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.listeners[type];
    if (!list) return;
    this.emitting++;
    try {
      // Longueur figée : un écouteur ajouté pendant l'émission attend la suivante.
      for (let i = 0, n = list.length; i < n; i++) list[i]?.(payload);
    } finally {
      if (--this.emitting === 0 && this.dirty) this.compact();
    }
  }

  /** Retire tous les écouteurs. */
  clear(): void {
    for (const key of Object.keys(this.listeners) as (keyof E)[]) delete this.listeners[key];
  }

  private compact(): void {
    this.dirty = false;
    for (const key of Object.keys(this.listeners) as (keyof E)[]) {
      const list = this.listeners[key];
      if (!list) continue;
      let w = 0;
      for (let r = 0; r < list.length; r++) {
        const fn = list[r];
        if (fn) list[w++] = fn;
      }
      list.length = w;
    }
  }
}
