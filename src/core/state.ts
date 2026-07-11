import type { WorldState } from './types'

type StateListener = (state: WorldState, changed: keyof WorldState) => void

const state: WorldState = {
  timeOfDay: 'noon',
  weather: 'clear',
  lamps: { andon: false, deskLamp: false, chochin: false },
  shojiOpen: false,
  radioPlaying: false,
  bonfireLit: false,
}

const listeners = new Set<StateListener>()

export const store = {
  get state(): Readonly<WorldState> {
    return state
  },
  set<K extends keyof WorldState>(key: K, value: WorldState[K]): void {
    if (state[key] === value) return
    state[key] = value
    for (const l of listeners) l(state, key)
  },
  setLamp(id: keyof WorldState['lamps'], on: boolean): void {
    if (state.lamps[id] === on) return
    state.lamps[id] = on
    for (const l of listeners) l(state, 'lamps')
  },
  on(listener: StateListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
