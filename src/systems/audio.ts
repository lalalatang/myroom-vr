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

  const builders: Record<SfxName, () => Built> = {
    kon: buildKon,
    chime: buildChime,
    slide: buildSlide,
    click: buildClick,
    ignite: buildIgnite,
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
      : new THREE.Vector3(0, 0.8, LAYOUT.STUDY.minZ + 1)

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

  // -- 屋内判定(雨のこもり用): 書斎・土間の屋根下 --
  const isIndoors = (): boolean => {
    const p = ctx.camera.getWorldPosition(_tmp)
    const inStudy =
      p.x >= LAYOUT.STUDY.minX && p.x <= LAYOUT.STUDY.maxX &&
      p.z >= LAYOUT.STUDY.minZ && p.z <= LAYOUT.STUDY.maxZ
    const inDoma =
      p.x >= LAYOUT.DOMA.minX && p.x <= LAYOUT.DOMA.maxX &&
      p.z >= LAYOUT.DOMA.minZ && p.z <= LAYOUT.DOMA.maxZ
    return inStudy || inDoma
  }

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
    },
  }
}
