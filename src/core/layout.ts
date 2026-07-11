/**
 * 空間レイアウト規約(全モジュール共有・変更時は全体影響に注意)。
 * 北(-Z)に家屋、南(+Z)に庭。単位はメートル、現実準拠スケール。
 * 全体は 20m × 20m(x,z ∈ [-10,10])に収める。
 */
export const LAYOUT = {
  /** 書斎(畳の間)。床は高床 */
  STUDY: { minX: -4, maxX: 4, minZ: -9, maxZ: -3, floorY: 0.4, ceilingY: 2.8 },
  /** 土間(三和土)。書斎の西側、地面高。スポーン地点を含む */
  DOMA: { minX: -6, maxX: -4, minZ: -9, maxZ: -3, floorY: 0 },
  /** 縁側(濡れ縁)。書斎の南、庭に面する */
  ENGAWA: { minX: -4, maxX: 4, minZ: -3, maxZ: -1.4, floorY: 0.4 },
  /** 庭。地面高0 */
  GARDEN: { minX: -10, maxX: 10, minZ: -1.4, maxZ: 10, groundY: 0 },
  /** 障子の通り(書斎と縁側の境界) */
  SHOJI_Z: -3,
  /** スポーン(土間)。yはリグ足元=0、プレイヤー目線はカメラ側で+1.6m */
  SPAWN: { x: -5, y: 0, z: -6, yaw: -Math.PI / 2 }, // 東(書斎・庭方向)を向く
  /** 目線高さ(デスクトップフォールバック用) */
  EYE_HEIGHT: 1.6,
} as const
