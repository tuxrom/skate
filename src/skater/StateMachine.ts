/**
 * Machine à états générique du skateur. Chaque état reçoit le contexte partagé
 * et renvoie l'identifiant de l'état suivant (ou null pour rester).
 */
export interface State<Id extends string, Ctx> {
  readonly id: Id;
  enter?(ctx: Ctx, from: Id | null): void;
  exit?(ctx: Ctx, to: Id): void;
  /** Appelé à pas fixe. */
  update(ctx: Ctx, dt: number): Id | null;
}

export class StateMachine<Id extends string, Ctx> {
  private readonly states = new Map<Id, State<Id, Ctx>>();
  private currentState: State<Id, Ctx> | null = null;
  /** Temps passé dans l'état courant (s). */
  timeInState = 0;

  constructor(private readonly ctx: Ctx) {}

  add(state: State<Id, Ctx>): this {
    this.states.set(state.id, state);
    return this;
  }

  get current(): Id | null {
    return this.currentState?.id ?? null;
  }

  start(id: Id): void {
    this.transition(id);
  }

  update(dt: number): void {
    if (!this.currentState) return;
    this.timeInState += dt;
    const next = this.currentState.update(this.ctx, dt);
    if (next !== null && next !== this.currentState.id) this.transition(next);
  }

  private transition(id: Id): void {
    const next = this.states.get(id);
    if (!next) throw new Error(`État inconnu : ${id}`);
    const prev = this.currentState;
    prev?.exit?.(this.ctx, id);
    this.currentState = next;
    this.timeInState = 0;
    next.enter?.(this.ctx, prev?.id ?? null);
  }
}
