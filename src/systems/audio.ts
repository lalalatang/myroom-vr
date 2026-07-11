import type { AppContext, System, WorldRefs } from '../core/types'

/**
 * 空間オーディオ。
 * - ラジオ: /audio/playlist.json を fetch し public/audio/*.mp3 を順次再生(PositionalAudio, refs.radio位置)。
 *   0件時はプロシージャルなラジオ風音声で代替。store.state.radioPlaying に反応
 * - 効果音: bus.on('sfx') で WebAudio 合成音を再生(kon/chime/slide/click/ignite)
 * - 環境音: 天候・時間帯に応じた虫の音・雨音など
 * TODO(opus-audio): 本実装。
 */
export function createAudio(_ctx: AppContext, _refs: WorldRefs): System {
  return { update() {} }
}
