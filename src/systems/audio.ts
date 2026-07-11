import * as THREE from 'three'
import type { AppContext, System, WorldRefs } from '../core/types'
import type { SfxName } from '../core/events'
import { store } from '../core/state'
import { bus } from '../core/events'
import { LAYOUT } from '../core/layout'

/**
 * 空間オーディオ + 音系ギミック(DECISIONS.md D4: 効果音・環境音はすべて WebAudio でプロシージャル合成)。
 *
 * - AudioContext はブラウザの自動再生制限のため、最初のユーザー操作(click/keydown/XR sessionstart)で resume。
 * - ラジオ(P0-4): 相対パス 'audio/playlist.json' を fetch → ファイル名配列。radioPlaying に反応して
 *   PositionalAudio(refs.radio, refDistance~0.8)で 'audio/<file>' を順次再生(末尾ループ)。
 *   playlist が空/取得失敗なら「深夜ラジオ風」プロシージャル音(帯域を絞ったノイズ + ペンタトニックの
 *   ゆらぐトーン列)で代替。ON/OFF 時に「カチッ」。
 * - sfx バス: kon/chime/slide/click/ignite を合成。position 付きは PositionalAudio、無しは非定位。
 * - 環境音: 夜=虫の音、雨=雨音(屋内でこもる)、焚き火点火中=パチパチ。すべて控えめなゲイン。
 */
export function createAudio(ctx: AppContext, refs: WorldRefs): System {
  const audioCtx = ctx.listener.context as AudioContext
  const listenerInput = ctx.listener.getInput()
  const _tmp = new THREE.Vector3()

  // ---- 自動再生制限の解除 ------------------------------------------------
  const resume = (): void => {
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  }
  window.addEventListener('click', resume)
  window.addEventListener('keydown', resume)
  window.addEventListener('touchstart', resume, { passive: true })
  ctx.renderer.xr.addEventListener('sessionstart', resume)

  // ---- 共有ノイズバッファ ------------------------------------------------
  const makeNoise = (seconds: number, pink = false): AudioBuffer => {
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * seconds))
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate)
    const d = buf.getChannelData(0)
    if (!pink) {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } else {
      // Paul Kellet のピンクノイズ近似
      let b0 = 0, b1 = 0, b2 = 0
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99765 * b0 + w * 0.099046
        b1 = 0.963 * b1 + w * 0.2965164
        b2 = 0.57 * b2 + w * 1.0526913
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
      }
    }
    return buf
  }
  const noiseBuffer = makeNoise(2)
  const pinkBuffer = makeNoise(3, true)

  const now = (): number => audioCtx.currentTime
  const running = (): boolean => audioCtx.state === 'running'

  // =======================================================================
  // 効果音(sfx バス)
  // =======================================================================
  interface Built {
    out: GainNode
    duration: number
  }

  const buildKon = (): Built => {
    // 竹と石の打撃: ~180Hz の減衰音 + 木質の 2〜3 倍音 + 矩形の "トック"
    const t = now()
    const out = audioCtx.createGain()
    const dur = 0.3
    const mults = [1, 2, 3]
    const peaks = [0.8, 0.25, 0.12]
    for (let i = 0; i < mults.length; i++) {
      const osc = audioCtx.createOscillator()
      osc.type = 'sine'
      const base = 180 * mults[i]
      osc.frequency.setValueAtTime(base * 1.15, t)
      osc.frequency.exponentialRampToValueAtTime(base, t + 0.05)
      const g = audioCtx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peaks[i], t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 - i * 0.2))
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    }
    const sq = audioCtx.createOscillator()
    sq.type = 'square'
    sq.frequency.setValueAtTime(190, t)
    sq.frequency.exponentialRampToValueAtTime(140, t + 0.03)
    const sg = audioCtx.createGain()
    sg.gain.setValueAtTime(0.3, t)
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    sq.connect(sg).connect(out)
    sq.start(t)
    sq.stop(t + 0.1)
    return { out, duration: dur }
  }

  const buildChime = (): Built => {
    // 風鈴: 高い倍音3つ(ベル風の非整数比)、長い減衰、わずかにデチューン
    const t = now()
    const out = audioCtx.createGain()
    const dur = 2.0
    const base = 2600 + Math.random() * 1200 // 2600〜3800Hz
    const ratios = [1, 2.76, 5.4]
    const peaks = [0.5, 0.25, 0.12]
    for (let i = 0; i < ratios.length; i++) {
      const osc = audioCtx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = base * ratios[i]
      osc.detune.value = (Math.random() * 2 - 1) * 8
      const g = audioCtx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peaks[i], t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 - i * 0.25))
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + dur + 0.1)
    }
    return { out, duration: dur }
  }

  const buildSlide = (): Built => {
    // 障子: ローパスしたノイズ 0.4s、シューッ
    const t = now()
    const dur = 0.4
    const out = audioCtx.createGain()
    const src = audioCtx.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    const lp = audioCtx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1100
    const g = audioCtx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.35, t + 0.08)
    g.gain.linearRampToValueAtTime(0.25, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0.0001, t + dur)
    src.connect(lp).connect(g).connect(out)
    src.start(t)
    src.stop(t + dur + 0.05)
    return { out, duration: dur }
  }

  const buildClick = (): Built => {
    // スイッチ / ラジオの「カチッ」
    const t = now()
    const dur = 0.05
    const out = audioCtx.createGain()
    const src = audioCtx.createBufferSource()
    src.buffer = noiseBuffer
    const bp = audioCtx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2000
    bp.Q.value = 1
    const g = audioCtx.createGain()
    g.gain.setValueAtTime(0.5, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp).connect(g).connect(out)
    src.start(t)
    src.stop(t + dur + 0.02)
    return { out, duration: dur }
  }

  const buildIgnite = (): Built => {
    // 着火: ノイズバースト(ローパスを下方スイープ)
    const t = now()
    const dur = 0.7
    const out = audioCtx.createGain()
    const src = audioCtx.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    const lp = audioCtx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(3000, t)
    lp.frequency.exponentialRampToValueAtTime(400, t + dur)
    const g = audioCtx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(lp).connect(g).connect(out)
    src.start(t)
    src.stop(t + dur + 0.05)
    return { out, duration: dur }
  }

  // -- v2: 井戸の水音「どぼん」 --
  const buildSplash = (): Built => {
    // 桶に落ちる水: ローパスを下降スイープするノイズバースト + 低い「ゴポッ」+ 桶の反響リング
    const t = now()
    const dur = 0.6
    const out = audioCtx.createGain()
    // 飛沫(広帯域→低域へ)
    const src = audioCtx.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    const lp = audioCtx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1800, t)
    lp.frequency.exponentialRampToValueAtTime(300, t + dur)
    const ng = audioCtx.createGain()
    ng.gain.setValueAtTime(0.0001, t)
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.02)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(lp).connect(ng).connect(out)
    src.start(t)
    src.stop(t + dur + 0.05)
    // 水塊が沈む「ゴポッ」(ピッチ下降)
    const glug = audioCtx.createOscillator()
    glug.type = 'sine'
    glug.frequency.setValueAtTime(220, t)
    glug.frequency.exponentialRampToValueAtTime(90, t + 0.25)
    const gg = audioCtx.createGain()
    gg.gain.setValueAtTime(0.0001, t)
    gg.gain.exponentialRampToValueAtTime(0.5, t + 0.03)
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    glug.connect(gg).connect(out)
    glug.start(t)
    glug.stop(t + 0.45)
    // 桶の反響感(共鳴バンドパスのリング)
    const rsrc = audioCtx.createBufferSource()
    rsrc.buffer = noiseBuffer
    const ring = audioCtx.createBiquadFilter()
    ring.type = 'bandpass'
    ring.frequency.value = 500
    ring.Q.value = 6
    const rg = audioCtx.createGain()
    rg.gain.setValueAtTime(0.0001, t + 0.02)
    rg.gain.exponentialRampToValueAtTime(0.2, t + 0.06)
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    rsrc.connect(ring).connect(rg).connect(out)
    rsrc.start(t)
    rsrc.stop(t + dur + 0.05)
    return { out, duration: dur }
  }

  // -- v2: 小銭の「チャリン」 --
  const buildCoin = (): Built => {
    // 高い金属倍音の束を 2〜3 回跳ねさせる(非整数比 = 金属的、4〜8kHz の減衰リング)
    const t = now()
    const dur = 0.5
    const out = audioCtx.createGain()
    const bounces = 3
    const ratios = [1, 1.84, 2.41, 3.2]
    for (let b = 0; b < bounces; b++) {
      const bt = t + b * (0.07 + b * 0.02)
      const amp = 0.45 * Math.pow(0.6, b)
      const base = 5200 + Math.random() * 1600
      const rdur = 0.15 * (1 - b * 0.2)
      for (let i = 0; i < ratios.length; i++) {
        const osc = audioCtx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = base * ratios[i]
        const g = audioCtx.createGain()
        g.gain.setValueAtTime(0.0001, bt)
        g.gain.exponentialRampToValueAtTime(amp * (1 - i * 0.2), bt + 0.002)
        g.gain.exponentialRampToValueAtTime(0.0001, bt + rdur)
        osc.connect(g).connect(out)
        osc.start(bt)
        osc.stop(bt + rdur + 0.02)
      }
    }
    return { out, duration: dur }
  }

  // -- v2: 賽銭箱命中(木箱のコトン + チャリン) --
  const buildCoinTarget = (): Built => {
    const t = now()
    const dur = 0.5
    const out = audioCtx.createGain()
    // 木箱の「コトン」(低い木質の減衰)
    const woods = [150, 380]
    for (let i = 0; i < woods.length; i++) {
      const osc = audioCtx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(woods[i] * 1.1, t)
      osc.frequency.exponentialRampToValueAtTime(woods[i], t + 0.04)
      const g = audioCtx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.5 * (1 - i * 0.3), t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 * (1 - i * 0.3))
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + 0.25)
    }
    // 重ねてチャリン
    const coin = buildCoin()
    coin.out.connect(out)
    return { out, duration: dur }
  }

  const builders: Record<SfxName, () => Built> = {
    kon: buildKon,
    chime: buildChime,
    slide: buildSlide,
    click: buildClick,
    ignite: buildIgnite,
    // v2: プロシージャル合成(井戸/小銭/賽銭)
    splash: buildSplash,
    coin: buildCoin,
    coinTarget: buildCoinTarget,
  }

  const playPositional = (out: GainNode, pos: THREE.Vector3, dur: number, refDist = 1): void => {
    const pa = new THREE.PositionalAudio(ctx.listener)
    pa.setRefDistance(refDist)
    pa.setNodeSource(out)
    pa.position.copy(pos)
    ctx.scene.add(pa)
    pa.updateMatrixWorld()
    window.setTimeout(() => {
      try {
        pa.disconnect()
      } catch {
        /* noop */
      }
      ctx.scene.remove(pa)
    }, (dur + 0.3) * 1000)
  }

  const playGlobal = (out: GainNode, dur: number): void => {
    const a = new THREE.Audio(ctx.listener)
    a.setNodeSource(out)
    window.setTimeout(() => {
      try {
        a.disconnect()
      } catch {
        /* noop */
      }
    }, (dur + 0.3) * 1000)
  }

  bus.on('sfx', ({ name, position }) => {
    if (!running()) return
    const build = builders[name]
    if (!build) return
    const built = build()
    if (position) playPositional(built.out, position, built.duration, 1)
    else playGlobal(built.out, built.duration)
  })

  // =======================================================================
  // ラジオ(P0-4)
  // =======================================================================
  const radioPos = (): THREE.Vector3 =>
    refs.radio
      ? refs.radio.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, 0.8, LAYOUT.OKUNOMA.minZ + 1)

  let radioMode: 'files' | 'procedural' | 'pending' = 'pending'
  let radioTracks: string[] = []
  let radioIndex = 0
  const audioLoader = new THREE.AudioLoader()

  // -- ファイル再生 --
  let radioFileAudio: THREE.PositionalAudio | null = null
  const ensureRadioFileAudio = (): THREE.PositionalAudio => {
    if (!radioFileAudio) {
      radioFileAudio = new THREE.PositionalAudio(ctx.listener)
      radioFileAudio.setRefDistance(0.8)
      radioFileAudio.setVolume(0.8)
      radioFileAudio.position.copy(radioPos())
      ctx.scene.add(radioFileAudio)
      radioFileAudio.updateMatrixWorld()
    }
    return radioFileAudio
  }
  const playFileTrack = (i: number): void => {
    if (!radioTracks.length) return
    const a = ensureRadioFileAudio()
    const file = 'audio/' + radioTracks[i % radioTracks.length]
    audioLoader.load(
      file,
      (buf) => {
        if (!store.state.radioPlaying || radioMode !== 'files') return
        if (a.isPlaying) a.stop()
        a.setBuffer(buf)
        a.setLoop(false)
        a.onEnded = () => {
          ;(a as unknown as { isPlaying: boolean }).isPlaying = false
          radioIndex = (radioIndex + 1) % radioTracks.length
          if (store.state.radioPlaying && radioMode === 'files') playFileTrack(radioIndex)
        }
        a.play()
      },
      undefined,
      () => {
        // 読み込み失敗時は次の曲へ(全滅ならプロシージャルに退避)
        radioIndex = (radioIndex + 1) % radioTracks.length
        if (radioIndex !== 0 && store.state.radioPlaying) playFileTrack(radioIndex)
      },
    )
  }

  // -- プロシージャル「深夜ラジオ風」--
  let radioProcOut: GainNode | null = null
  let radioMelodyGain: GainNode | null = null
  let radioProcAudio: THREE.PositionalAudio | null = null
  const pentatonic: number[] = []
  {
    // A マイナーペンタトニック(半音 0,3,5,7,10)を 2 オクターブ
    const semis = [0, 3, 5, 7, 10]
    const rootHz = 220
    for (let oct = 0; oct < 2; oct++) {
      for (const s of semis) pentatonic.push(rootHz * Math.pow(2, oct + s / 12))
    }
  }
  let walkIdx = Math.floor(pentatonic.length / 2)
  let nextRadioNoteTime = 0

  const buildRadioProc = (): void => {
    if (radioProcOut) return
    const out = audioCtx.createGain()
    out.gain.value = 0 // ON/OFF ゲート
    // 帯域を絞ったノイズ(~2kHz bandpass)= AM ラジオのサーッという地
    const noise = audioCtx.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true
    const bp = audioCtx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2000
    bp.Q.value = 1.5
    const noiseGain = audioCtx.createGain()
    noiseGain.gain.value = 0.06
    noise.connect(bp).connect(noiseGain).connect(out)
    noise.start()
    // トーン列(update でノートをスケジュール)
    const melodyGain = audioCtx.createGain()
    melodyGain.gain.value = 1
    melodyGain.connect(out)

    const pa = new THREE.PositionalAudio(ctx.listener)
    pa.setRefDistance(0.8)
    pa.setNodeSource(out)
    pa.position.copy(radioPos())
    ctx.scene.add(pa)
    pa.updateMatrixWorld()

    radioProcOut = out
    radioMelodyGain = melodyGain
    radioProcAudio = pa
  }

  const scheduleRadioNote = (when: number): void => {
    if (!radioMelodyGain) return
    // ゆっくりランダムウォーク
    walkIdx = Math.min(pentatonic.length - 1, Math.max(0, walkIdx + (Math.random() < 0.5 ? -1 : 1)))
    const f = pentatonic[walkIdx]
    const osc = audioCtx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = f
    // わずかなゆらぎ(ビブラート)
    const lfo = audioCtx.createOscillator()
    const lfoGain = audioCtx.createGain()
    lfo.frequency.value = 5
    lfoGain.gain.value = 4
    lfo.connect(lfoGain).connect(osc.detune)
    const g = audioCtx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(0.18, when + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.8)
    osc.connect(g).connect(radioMelodyGain)
    lfo.start(when)
    lfo.stop(when + 0.9)
    osc.start(when)
    osc.stop(when + 0.9)
  }

  const setRadioProcActive = (active: boolean): void => {
    buildRadioProc()
    if (!radioProcOut) return
    const t = now()
    radioProcOut.gain.cancelScheduledValues(t)
    radioProcOut.gain.setValueAtTime(radioProcOut.gain.value, t)
    radioProcOut.gain.linearRampToValueAtTime(active ? 0.5 : 0, t + 0.15)
    if (active) nextRadioNoteTime = t + 0.3
  }

  const applyRadio = (playing: boolean): void => {
    // トグルのたびに「カチッ」
    if (running()) {
      const c = buildClick()
      playPositional(c.out, radioPos(), c.duration, 0.8)
    }
    if (radioMode === 'files') {
      if (playing) {
        setRadioProcActive(false)
        const a = ensureRadioFileAudio()
        if (a.buffer && !a.isPlaying) a.play()
        else if (!a.buffer) playFileTrack(radioIndex)
      } else {
        if (radioFileAudio && radioFileAudio.isPlaying) radioFileAudio.pause()
      }
    } else {
      // pending も含めプロシージャルで鳴らす(fetch 解決後に切替)
      setRadioProcActive(playing)
    }
  }

  fetch('audio/playlist.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((list: unknown) => {
      if (Array.isArray(list)) {
        radioTracks = list.filter((x): x is string => typeof x === 'string')
      }
      radioMode = radioTracks.length ? 'files' : 'procedural'
      // 取得前に再生開始していた場合は再適用(プロシージャル→ファイル等)
      if (store.state.radioPlaying) {
        if (radioMode === 'files') setRadioProcActive(false)
        applyRadio(true)
      }
    })
    .catch(() => {
      radioMode = 'procedural'
      if (store.state.radioPlaying) applyRadio(true)
    })

  store.on((s, changed) => {
    if (changed === 'radioPlaying') applyRadio(s.radioPlaying)
  })

  // =======================================================================
  // 環境音
  // =======================================================================
  // -- 雨(非定位・屋内でこもる) --
  const rainSource = audioCtx.createBufferSource()
  rainSource.buffer = pinkBuffer
  rainSource.loop = true
  const rainLP = audioCtx.createBiquadFilter()
  rainLP.type = 'lowpass'
  rainLP.frequency.value = 6000
  const rainGain = audioCtx.createGain()
  rainGain.gain.value = 0
  rainSource.connect(rainLP).connect(rainGain).connect(listenerInput)
  rainSource.start()

  // -- 虫の音(夜・非定位。update でチチチ…をスケジュール) --
  const insectGain = audioCtx.createGain()
  insectGain.gain.value = 0.5
  insectGain.connect(listenerInput)
  let nextCricketTime = 0

  const scheduleCricket = (when: number): void => {
    const carrier = audioCtx.createOscillator()
    carrier.type = 'sine'
    carrier.frequency.value = 3800 + Math.random() * 500
    const am = audioCtx.createGain()
    am.gain.setValueAtTime(0.0001, when)
    const pulses = 3 + Math.floor(Math.random() * 3)
    let t = when
    for (let i = 0; i < pulses; i++) {
      am.gain.setValueAtTime(0.0001, t)
      am.gain.linearRampToValueAtTime(0.12, t + 0.008)
      am.gain.linearRampToValueAtTime(0.0001, t + 0.03)
      t += 0.045
    }
    carrier.connect(am).connect(insectGain)
    carrier.start(when)
    carrier.stop(t + 0.05)
  }

  // -- 焚き火のパチパチ(bonfire 位置の PositionalAudio) --
  let bonfireOut: GainNode | null = null
  let crackleGain: GainNode | null = null
  let crackleTimer = 0
  const bonfirePos = (): THREE.Vector3 =>
    refs.bonfire
      ? refs.bonfire.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(4, 0.2, 4)

  const buildBonfireAudio = (): void => {
    if (bonfireOut) return
    const out = audioCtx.createGain()
    out.gain.value = 0
    // 低いゴーッという燃焼のベッド
    const bed = audioCtx.createBufferSource()
    bed.buffer = pinkBuffer
    bed.loop = true
    const bedLP = audioCtx.createBiquadFilter()
    bedLP.type = 'lowpass'
    bedLP.frequency.value = 500
    const bedGain = audioCtx.createGain()
    bedGain.gain.value = 0.4
    bed.connect(bedLP).connect(bedGain).connect(out)
    bed.start()
    // パチパチ(高域ノイズをゲインスパイクで断続)
    const pop = audioCtx.createBufferSource()
    pop.buffer = noiseBuffer
    pop.loop = true
    const popHP = audioCtx.createBiquadFilter()
    popHP.type = 'highpass'
    popHP.frequency.value = 1500
    const cg = audioCtx.createGain()
    cg.gain.value = 0
    pop.connect(popHP).connect(cg).connect(out)
    pop.start()

    const pa = new THREE.PositionalAudio(ctx.listener)
    pa.setRefDistance(1.5)
    pa.setNodeSource(out)
    pa.position.copy(bonfirePos())
    ctx.scene.add(pa)
    pa.updateMatrixWorld()

    bonfireOut = out
    crackleGain = cg
  }

  // -- 屋内判定(雨のこもり・通りの賑わい減衰用): 奥の間・店先の屋根下 --
  const isIndoors = (): boolean => {
    const p = ctx.camera.getWorldPosition(_tmp)
    const inOkunoma =
      p.x >= LAYOUT.OKUNOMA.minX && p.x <= LAYOUT.OKUNOMA.maxX &&
      p.z >= LAYOUT.OKUNOMA.minZ && p.z <= LAYOUT.OKUNOMA.maxZ
    const inMise =
      p.x >= LAYOUT.MISE.minX && p.x <= LAYOUT.MISE.maxX &&
      p.z >= LAYOUT.MISE.minZ && p.z <= LAYOUT.MISE.maxZ
    return inOkunoma || inMise
  }

  // =======================================================================
  // v2: 通りの賑わい(第1層・音が主役)+ 屋内減衰(受け入れ基準)
  // =======================================================================
  // 屋内での通り系音源のマスター(ゲイン/ローパス)。update で滑らかに補間し、
  // 連続音はノードへ直接反映、単発音(物売り・足音・鐘・犬)は発生時にこの値を焼き込む。
  let curStreetGain = 1
  let curStreetLPF = 20000

  interface StreetSrc {
    lpf: BiquadFilterNode
    gain: GainNode
    base: number
    bustle: boolean // true = 時間帯の賑わい密度を掛ける
  }
  const streetSrcs: StreetSrc[] = []

  // 連続音の定位ソース: synthOut → 屋内LPF → 屋内Gain → PositionalAudio(→panner→listener)
  const addStreetSource = (
    synthOut: AudioNode,
    pos: THREE.Vector3,
    refDist: number,
    base: number,
    bustle: boolean,
  ): void => {
    const lpf = audioCtx.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.value = 20000
    const gain = audioCtx.createGain()
    gain.gain.value = base
    synthOut.connect(lpf).connect(gain)
    const pa = new THREE.PositionalAudio(ctx.listener)
    pa.setRefDistance(refDist)
    pa.setNodeSource(gain)
    pa.position.copy(pos)
    ctx.scene.add(pa)
    pa.updateMatrixWorld()
    streetSrcs.push({ lpf, gain, base, bustle })
  }

  // 単発の定位音: 現在の屋内減衰(curStreetGain/curStreetLPF)を焼き込んで再生
  const playStreetTransient = (
    synthOut: AudioNode,
    pos: THREE.Vector3,
    dur: number,
    refDist: number,
  ): void => {
    const lpf = audioCtx.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.value = curStreetLPF
    const g = audioCtx.createGain()
    g.gain.value = curStreetGain
    synthOut.connect(lpf).connect(g)
    playPositional(g, pos, dur, refDist)
  }

  // -- ざわめき(遠い人の話し声のガヤ): 帯域制限ノイズ + 複数ゆらぎLFO + 笑い声風バースト。3点定位 --
  interface Bustle {
    burst: GainNode
    nextBurst: number
  }
  const bustles: Bustle[] = []
  const makeBustle = (pos: THREE.Vector3): void => {
    const bed = audioCtx.createGain() // synth 終端
    // 地のガヤ: ノイズを ~700〜2400Hz に帯域制限し、複数のゆっくりLFOで音量を波打たせる
    const noise = audioCtx.createBufferSource()
    noise.buffer = pinkBuffer
    noise.loop = true
    const hp = audioCtx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 700
    const lp = audioCtx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    const murmur = audioCtx.createGain()
    murmur.gain.value = 0.18
    noise.connect(hp).connect(lp).connect(murmur).connect(bed)
    noise.start()
    // 複数のゆらぎLFO(0.17〜0.43Hz)で murmur.gain を波打たせる = 群衆のうねり
    for (const def of [{ f: 0.17, d: 0.06 }, { f: 0.29, d: 0.05 }, { f: 0.43, d: 0.035 }]) {
      const lfo = audioCtx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = def.f
      const lg = audioCtx.createGain()
      lg.gain.value = def.d
      lfo.connect(lg).connect(murmur.gain)
      lfo.start()
    }
    // 笑い声風の短いバースト用(明るめの帯域、update でエンベロープ)
    const bnoise = audioCtx.createBufferSource()
    bnoise.buffer = noiseBuffer
    bnoise.loop = true
    const bbp = audioCtx.createBiquadFilter()
    bbp.type = 'bandpass'
    bbp.frequency.value = 1600
    bbp.Q.value = 1.2
    const burst = audioCtx.createGain()
    burst.gain.value = 0
    bnoise.connect(bbp).connect(burst).connect(bed)
    bnoise.start()
    addStreetSource(bed, pos, 9, 1.0, true)
    bustles.push({ burst, nextBurst: 3 + Math.random() * 6 })
  }
  // 通りの東・中・西(あちこちから聞こえる)
  makeBustle(new THREE.Vector3(-15, 1.2, 0.5))
  makeBustle(new THREE.Vector3(2, 1.2, 1.2))
  makeBustle(new THREE.Vector3(18, 1.2, 0.5))

  // -- 屋台の気配(湯の煮えるコポコポ + 時々の湯気シュッ) --
  let yataiBubble: GainNode | null = null
  let yataiSteam: GainNode | null = null
  let nextBubble = 0
  let nextSteam = 0
  if (refs.yatai) {
    const pos = refs.yatai.getWorldPosition(new THREE.Vector3())
    pos.y += 0.4
    const bed = audioCtx.createGain()
    // 低いお湯のゴボゴボの地
    const bnoise = audioCtx.createBufferSource()
    bnoise.buffer = pinkBuffer
    bnoise.loop = true
    const blp = audioCtx.createBiquadFilter()
    blp.type = 'lowpass'
    blp.frequency.value = 300
    const bg = audioCtx.createGain()
    bg.gain.value = 0.12
    bnoise.connect(blp).connect(bg).connect(bed)
    bnoise.start()
    // コポコポの粒(update で個別スケジュール)
    const bubble = audioCtx.createGain()
    bubble.gain.value = 1
    bubble.connect(bed)
    yataiBubble = bubble
    // 湯気シュッ
    const steamNoise = audioCtx.createBufferSource()
    steamNoise.buffer = noiseBuffer
    steamNoise.loop = true
    const shp = audioCtx.createBiquadFilter()
    shp.type = 'highpass'
    shp.frequency.value = 3500
    const steam = audioCtx.createGain()
    steam.gain.value = 0
    steamNoise.connect(shp).connect(steam).connect(bed)
    steamNoise.start()
    yataiSteam = steam
    addStreetSource(bed, pos, 2.2, 0.9, false) // refDistance 小 = 近づくと聞こえる
  }
  const scheduleBubble = (when: number): void => {
    if (!yataiBubble) return
    const o = audioCtx.createOscillator()
    o.type = 'sine'
    const f0 = 140 + Math.random() * 120
    o.frequency.setValueAtTime(f0 * 1.6, when)
    o.frequency.exponentialRampToValueAtTime(f0, when + 0.06)
    const g = audioCtx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09)
    o.connect(g).connect(yataiBubble)
    o.start(when)
    o.stop(when + 0.12)
  }

  // -- 物売りの声(母音フォルマント、上がって下がる節) --
  const buildVendorPhrase = (): Built => {
    const t = now()
    const dur = 2.2
    const out = audioCtx.createGain()
    // 声帯: のこぎり波。上がって下がる抑揚(「ぉ〜ぃ、ぇ〜」)
    const osc = audioCtx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(190, t)
    osc.frequency.linearRampToValueAtTime(300, t + 0.5)
    osc.frequency.linearRampToValueAtTime(280, t + 1.0)
    osc.frequency.linearRampToValueAtTime(175, t + 2.0)
    // ビブラート
    const vib = audioCtx.createOscillator()
    vib.type = 'sine'
    vib.frequency.value = 5.5
    const vibg = audioCtx.createGain()
    vibg.gain.value = 8
    vib.connect(vibg).connect(osc.detune)
    vib.start(t)
    vib.stop(t + dur)
    // 音節エンベロープ(2〜3 音の抑揚)
    const env = audioCtx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(0.4, t + 0.12)
    env.gain.linearRampToValueAtTime(0.36, t + 0.5)
    env.gain.linearRampToValueAtTime(0.1, t + 0.72)
    env.gain.linearRampToValueAtTime(0.4, t + 1.0)
    env.gain.linearRampToValueAtTime(0.36, t + 1.6)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(env)
    // フォルマント(母音)を並列バンドパスで
    for (const fm of [{ f: 700, q: 9, g: 0.6 }, { f: 1150, q: 11, g: 0.4 }, { f: 2600, q: 13, g: 0.15 }]) {
      const bp = audioCtx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = fm.f
      bp.Q.value = fm.q
      const fg = audioCtx.createGain()
      fg.gain.value = fm.g
      env.connect(bp).connect(fg).connect(out)
    }
    osc.start(t)
    osc.stop(t + dur + 0.05)
    return { out, duration: dur }
  }

  // -- 下駄・足音(カラン、コロン: 木質クリック2連、ピッチ違い) --
  const buildFootsteps = (): Built => {
    const t = now()
    const dur = 0.35
    const out = audioCtx.createGain()
    for (const c of [{ at: 0, base: 900 }, { at: 0.13, base: 720 }]) {
      const ct = t + c.at
      for (const [mul, amp] of [[1, 0.5], [2.4, 0.2]] as const) {
        const osc = audioCtx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(c.base * mul * 1.1, ct)
        osc.frequency.exponentialRampToValueAtTime(c.base * mul, ct + 0.02)
        const g = audioCtx.createGain()
        g.gain.setValueAtTime(0.0001, ct)
        g.gain.exponentialRampToValueAtTime(amp, ct + 0.003)
        g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.09)
        osc.connect(g).connect(out)
        osc.start(ct)
        osc.stop(ct + 0.12)
      }
      // 木の当たりノイズtick
      const nsrc = audioCtx.createBufferSource()
      nsrc.buffer = noiseBuffer
      const nbp = audioCtx.createBiquadFilter()
      nbp.type = 'bandpass'
      nbp.frequency.value = c.base * 2
      nbp.Q.value = 3
      const ng = audioCtx.createGain()
      ng.gain.setValueAtTime(0.3, ct)
      ng.gain.exponentialRampToValueAtTime(0.0001, ct + 0.03)
      nsrc.connect(nbp).connect(ng).connect(out)
      nsrc.start(ct)
      nsrc.stop(ct + 0.05)
    }
    return { out, duration: dur }
  }

  // -- 寺の鐘(低い基音 + 非整数倍音 + うなり + 長い減衰8s) --
  const buildBellStrike = (): Built => {
    const t = now()
    const dur = 8
    const out = audioCtx.createGain()
    const base = 110
    const partials = [
      { r: 1.0, a: 0.6, beat: 1.006 },
      { r: 2.03, a: 0.28, beat: 1.004 },
      { r: 2.79, a: 0.18, beat: 1.007 },
      { r: 4.1, a: 0.12, beat: 1.005 },
      { r: 5.9, a: 0.07, beat: 1.003 },
    ]
    for (const p of partials) {
      for (const bf of [1, p.beat]) {
        // うなり: 近接周波数の対
        const osc = audioCtx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = base * p.r * bf
        const d = Math.max(1, dur * (1 - (p.r - 1) * 0.06))
        const g = audioCtx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(p.a * 0.5, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + d)
        osc.connect(g).connect(out)
        osc.start(t)
        osc.stop(t + d + 0.1)
      }
    }
    // 撞木の当たり(木質アタック)
    const nsrc = audioCtx.createBufferSource()
    nsrc.buffer = noiseBuffer
    const nlp = audioCtx.createBiquadFilter()
    nlp.type = 'lowpass'
    nlp.frequency.value = 1200
    const ng = audioCtx.createGain()
    ng.gain.setValueAtTime(0.4, t)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    nsrc.connect(nlp).connect(ng).connect(out)
    nsrc.start(t)
    nsrc.stop(t + 0.2)
    return { out, duration: dur }
  }
  const bellPos = (): THREE.Vector3 =>
    refs.templeBellPos ? refs.templeBellPos.clone() : new THREE.Vector3(-60, 10, -50)
  const ringTempleBell = (): void => {
    if (!running()) return
    const pos = bellPos()
    const strikes = 2 + Math.floor(Math.random() * 2) // 2〜3 回
    for (let i = 0; i < strikes; i++) {
      window.setTimeout(() => {
        if (!running()) return
        playStreetTransient(buildBellStrike().out, pos, 8, 18)
      }, i * 5500)
    }
  }
  store.on((s, changed) => {
    if (changed === 'timeOfDay') ringTempleBell()
  })

  // -- 夜: 遠くの犬の遠吠え(稀) --
  const buildDogHowl = (): Built => {
    const t = now()
    const dur = 1.4
    const out = audioCtx.createGain()
    const osc = audioCtx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(200, t)
    osc.frequency.linearRampToValueAtTime(360, t + 0.5)
    osc.frequency.linearRampToValueAtTime(340, t + 0.8)
    osc.frequency.linearRampToValueAtTime(210, t + dur)
    const env = audioCtx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(0.3, t + 0.2)
    env.gain.linearRampToValueAtTime(0.28, t + 1.0)
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(env)
    const bp = audioCtx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900
    bp.Q.value = 6
    env.connect(bp).connect(out)
    osc.start(t)
    osc.stop(t + dur + 0.05)
    return { out, duration: dur }
  }

  // 街の単発音のタイマー(初回に未来へ初期化)
  let nextVendorTime = 0
  let nextFootstepTime = 0
  let nextDogTime = 0

  // =======================================================================
  // update
  // =======================================================================
  const approach = (param: AudioParam, target: number, dt: number, rate = 3): void => {
    const k = 1 - Math.exp(-rate * dt)
    param.value += (target - param.value) * k
  }

  return {
    update(dt: number): void {
      if (!running()) return
      const t = now()
      const s = store.state

      // -- 雨 --
      const rainTarget = s.weather === 'rain' ? 0.18 : 0
      approach(rainGain.gain, rainTarget, dt)
      const lpTarget = isIndoors() ? 1400 : 6000
      approach(rainLP.frequency, lpTarget, dt, 2)

      // -- 虫の音(夜) --
      if (s.timeOfDay === 'night') {
        if (nextCricketTime < t) nextCricketTime = t
        // 少し先読みしてスケジュール(2 匹重ねる)
        while (nextCricketTime < t + 0.2) {
          scheduleCricket(nextCricketTime)
          if (Math.random() < 0.6) scheduleCricket(nextCricketTime + Math.random() * 0.1)
          nextCricketTime += 0.4 + Math.random() * 0.6
        }
      }

      // -- ラジオのプロシージャル・トーン列 --
      if (s.radioPlaying && radioMode !== 'files' && radioProcOut && radioProcOut.gain.value > 0.01) {
        if (nextRadioNoteTime < t) nextRadioNoteTime = t
        while (nextRadioNoteTime < t + 0.3) {
          scheduleRadioNote(nextRadioNoteTime)
          nextRadioNoteTime += 0.45 + Math.random() * 0.7
        }
      }

      // -- 焚き火のパチパチ --
      if (s.bonfireLit) {
        buildBonfireAudio()
        if (bonfireOut) approach(bonfireOut.gain, 0.35, dt, 4)
        if (crackleGain) {
          crackleTimer -= dt
          while (crackleTimer <= 0) {
            const ct = t + Math.random() * 0.02
            crackleGain.gain.setValueAtTime(0.0001, ct)
            crackleGain.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.35, ct + 0.005)
            crackleGain.gain.exponentialRampToValueAtTime(0.0001, ct + 0.03 + Math.random() * 0.05)
            crackleTimer += 0.03 + Math.random() * 0.16
          }
        }
      } else if (bonfireOut && bonfireOut.gain.value > 0.001) {
        approach(bonfireOut.gain, 0, dt, 4)
      }

      // ================= v2: 通りの賑わい =================
      // -- 屋内減衰(通り系マスターのゲイン/ローパス)を滑らかに補間 --
      const indoors = isIndoors()
      let gTgt: number
      let lpTgt2: number
      if (!indoors) {
        gTgt = 1.0
        lpTgt2 = 20000 // 実質フィルタなし
      } else if (s.shojiOpen) {
        gTgt = 0.55
        lpTgt2 = 2500 // 障子開
      } else {
        gTgt = 0.25
        lpTgt2 = 900 // 障子閉(奥の間は静か)
      }
      const kk = 1 - Math.exp(-3 * dt)
      curStreetGain += (gTgt - curStreetGain) * kk
      curStreetLPF += (lpTgt2 - curStreetLPF) * kk
      // 時間帯の賑わい密度(昼=最大、朝=中、夕=やや減、夜=ほぼ無音)
      const density =
        s.timeOfDay === 'noon' ? 1.0 :
        s.timeOfDay === 'morning' ? 0.5 :
        s.timeOfDay === 'evening' ? 0.65 : 0.06
      for (const src of streetSrcs) {
        src.gain.gain.value = src.base * curStreetGain * (src.bustle ? density : 1)
        src.lpf.frequency.value = curStreetLPF
      }
      // 笑い声風バースト
      for (const b of bustles) {
        b.nextBurst -= dt
        if (b.nextBurst <= 0) {
          const bt = t + 0.01
          b.burst.gain.cancelScheduledValues(bt)
          b.burst.gain.setValueAtTime(0.0001, bt)
          b.burst.gain.linearRampToValueAtTime(0.22 + Math.random() * 0.1, bt + 0.12)
          b.burst.gain.exponentialRampToValueAtTime(0.0001, bt + 0.5 + Math.random() * 0.4)
          b.nextBurst = (4 + Math.random() * 8) / Math.max(0.2, density)
        }
      }
      // 屋台のコポコポ / 湯気
      if (yataiBubble) {
        if (nextBubble < t) nextBubble = t
        while (nextBubble < t + 0.25) {
          scheduleBubble(nextBubble)
          nextBubble += 0.18 + Math.random() * 0.35
        }
      }
      if (yataiSteam && nextSteam < t) {
        const st = t + 0.01
        yataiSteam.gain.cancelScheduledValues(st)
        yataiSteam.gain.setValueAtTime(0.0001, st)
        yataiSteam.gain.linearRampToValueAtTime(0.14, st + 0.05)
        yataiSteam.gain.exponentialRampToValueAtTime(0.0001, st + 0.35)
        nextSteam = t + 6 + Math.random() * 10
      }
      // 物売りの声(2〜4分に一度、昼中心、夜なし)
      if (nextVendorTime === 0) nextVendorTime = t + 30 + Math.random() * 60
      if (s.timeOfDay === 'night') {
        nextVendorTime = t + 60
      } else if (t >= nextVendorTime) {
        if (Math.random() < (s.timeOfDay === 'noon' ? 1 : 0.5)) {
          const vpos = new THREE.Vector3(
            -24 + Math.random() * 52,
            1.4,
            (Math.random() * 2 - 1) * 1.5,
          )
          playStreetTransient(buildVendorPhrase().out, vpos, 2.2, 12)
        }
        nextVendorTime = t + 120 + Math.random() * 120
      }
      // 下駄・足音(プレイヤー近くの通り上、昼多め)
      if (nextFootstepTime === 0) nextFootstepTime = t + 2 + Math.random() * 4
      if (t >= nextFootstepTime) {
        if (Math.random() < density) {
          const p = ctx.camera.getWorldPosition(_tmp)
          const fx = THREE.MathUtils.clamp(
            p.x + (Math.random() * 2 - 1) * 6,
            LAYOUT.STREET.minX,
            LAYOUT.STREET.maxX,
          )
          const fz = THREE.MathUtils.clamp(
            p.z + (Math.random() * 2 - 1) * 3,
            LAYOUT.STREET.minZ,
            LAYOUT.STREET.maxZ,
          )
          playStreetTransient(buildFootsteps().out, new THREE.Vector3(fx, 0.1, fz), 0.35, 4)
        }
        nextFootstepTime = t + (2 + Math.random() * 5) / Math.max(0.3, density)
      }
      // 夜: 遠くの犬の遠吠え(稀)
      if (s.timeOfDay === 'night') {
        if (nextDogTime === 0) nextDogTime = t + 15 + Math.random() * 30
        if (t >= nextDogTime) {
          playStreetTransient(
            buildDogHowl().out,
            new THREE.Vector3(-24 + Math.random() * 52, 1, -8 + Math.random() * 4),
            1.4,
            20,
          )
          nextDogTime = t + 25 + Math.random() * 40
        }
      }
    },
  }
}
