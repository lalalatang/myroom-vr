import type { AppContext, WorldRefs } from '../core/types'
import { buildMachiya } from './machiya'
import { buildStreet } from './street'
import { buildSkyline } from './skyline'

/**
 * ワールド全体(v2: 江戸の町)を構築し、各部の参照(WorldRefs)を返す。
 * machiya/street/skyline はそれぞれ Partial<WorldRefs> を返し、ここでマージする。
 */
export function buildWorld(ctx: AppContext): WorldRefs {
  const refs: WorldRefs = {
    teleportSurfaces: [],
    shojiPanels: [],
    lampFixtures: {},
    windowLightTargets: [],
    noren: [],
  }
  for (const part of [buildMachiya(ctx), buildStreet(ctx), buildSkyline(ctx)]) {
    refs.teleportSurfaces.push(...(part.teleportSurfaces ?? []))
    refs.shojiPanels.push(...(part.shojiPanels ?? []))
    Object.assign(refs.lampFixtures, part.lampFixtures ?? {})
    refs.windowLightTargets!.push(...(part.windowLightTargets ?? []))
    refs.noren!.push(...(part.noren ?? []))
    refs.radio = part.radio ?? refs.radio
    refs.kakejiku = part.kakejiku ?? refs.kakejiku
    refs.windChime = part.windChime ?? refs.windChime
    refs.pond = part.pond ?? refs.pond
    refs.well = part.well ?? refs.well
    refs.yatai = part.yatai ?? refs.yatai
    refs.kido = part.kido ?? refs.kido
    refs.templeBellPos = part.templeBellPos ?? refs.templeBellPos
    refs.coinTarget = part.coinTarget ?? refs.coinTarget
    refs.npcPathXRange = part.npcPathXRange ?? refs.npcPathXRange
    refs.shishiodoshi = part.shishiodoshi ?? refs.shishiodoshi
    refs.bonfire = part.bonfire ?? refs.bonfire
  }
  return refs
}
