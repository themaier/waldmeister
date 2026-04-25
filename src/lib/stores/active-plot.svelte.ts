// Session-scoped memory of the last Waldstück the user was looking at.
// In-memory only; resets on full reload.

let activePlotId = $state<string | null>(null);

export const activePlotStore = {
  get id() {
    return activePlotId;
  },
  set(id: string | null) {
    activePlotId = id;
  }
};
