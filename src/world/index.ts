import type { AppContext, WorldRefs } from '../core/types'
import { buildHouse } from './house'
import { buildGarden } from './garden'
import { buildFurniture } from './furniture'

/**
 * ワールド全体を構築し、各部の参照(WorldRefs)を返す。
 * house/garden/furniture はそれぞれ Partial<WorldRefs> を返し、ここでマージする。
 */
export function buildWorld(ctx: AppContext): WorldRefs {
  const refs: WorldRefs = {
    teleportSurfaces: [],
    shojiPanels: [],
    lampFixtures: {},
    windowLightTargets: [],
  }
  for (const part of [buildHouse(ctx), buildGarden(ctx), buildFurniture(ctx)]) {
    refs.teleportSurfaces.push(...(part.teleportSurfaces ?? []))
    refs.shojiPanels.push(...(part.shojiPanels ?? []))
    Object.assign(refs.lampFixtures, part.lampFixtures ?? {})
    refs.windowLightTargets!.push(...(part.windowLightTargets ?? []))
    refs.radio = part.radio ?? refs.radio
    refs.kakejiku = part.kakejiku ?? refs.kakejiku
    refs.shishiodoshi = part.shishiodoshi ?? refs.shishiodoshi
    refs.bonfire = part.bonfire ?? refs.bonfire
    refs.windChime = part.windChime ?? refs.windChime
    refs.pond = part.pond ?? refs.pond
  }
  return refs
}
