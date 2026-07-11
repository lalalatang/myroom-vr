#!/usr/bin/env bash
# CC0アセット取得スクリプト(Poly Haven HDRI + ambientCG PBRテクスチャ)。
# 何度実行しても安全(既存ファイルはスキップ)。費用は一切発生しない(すべてCC0・無料配布)。
# 連想配列はmacOS標準の /bin/bash (3.2) に無いため、case文で代用している。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC="$ROOT/public"
HDRI_DIR="$PUBLIC/hdri"
TEX_DIR="$PUBLIC/textures"
TMP_DIR="$ROOT/.assets-tmp"

mkdir -p "$HDRI_DIR" "$TEX_DIR" "$TMP_DIR"

CURL="curl --fail --location --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 15 --max-time 180 --silent --show-error"

log() { printf '[fetch-assets] %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 1) HDRI (Poly Haven, CC0, 2K .hdr) — 朝/昼/夕/夜
#    同一ロケーション(Qwantani)を時間帯違いで揃え、時間帯切替時の見た目の一貫性を確保。
# ---------------------------------------------------------------------------
HDRI_LABELS="morning noon evening night"

hdri_asset_id() {
  case "$1" in
    morning) echo "qwantani_morning" ;;
    noon) echo "qwantani_noon" ;;
    evening) echo "qwantani_sunset" ;;
    night) echo "qwantani_night" ;;
  esac
}

fetch_hdri() {
  label="$1"
  asset_id="$(hdri_asset_id "$label")"
  dest="$HDRI_DIR/${label}.hdr"
  if [ -s "$dest" ]; then
    log "hdri: $label ($asset_id) は取得済み。スキップ。"
    return 0
  fi
  log "hdri: $label ($asset_id) を取得中..."

  # Poly Haven API でファイルURLを解決(直リンクが変わっても追従できるように)。
  api_url="https://api.polyhaven.com/files/${asset_id}"
  resolved_url="$($CURL "$api_url" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d["hdri"]["2k"]["hdr"]["url"])
except Exception:
    pass
' 2>/dev/null)"

  if [ -z "$resolved_url" ]; then
    # APIが失敗した場合の既知の命名規則フォールバック。
    resolved_url="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${asset_id}_2k.hdr"
    log "hdri: $label API解決に失敗、既定URL形式にフォールバック: $resolved_url"
  fi

  tmp="$TMP_DIR/${label}.hdr.part"
  if $CURL -o "$tmp" "$resolved_url"; then
    mv "$tmp" "$dest"
    log "hdri: $label 取得成功 ($(du -h "$dest" | cut -f1))"
  else
    log "hdri: $label 取得失敗(スキップして続行。アプリ側はHDRI無しフォールバックで動作する)"
    rm -f "$tmp"
  fi
}

for label in $HDRI_LABELS; do
  fetch_hdri "$label"
done

# ---------------------------------------------------------------------------
# 2) テクスチャ (ambientCG, CC0, 1K JPG)
#    各エントリ: ディレクトリ名=用途。候補AssetIDが404なら検索APIで代替を探す。
# ---------------------------------------------------------------------------
TEXTURE_DIRS="wood_floor wood_dark tatami plaster stone washi ground roof"

texture_candidate_id() {
  case "$1" in
    wood_floor) echo "WoodFloor051" ;;
    wood_dark) echo "Wood051" ;;
    tatami) echo "Fabric062" ;;
    plaster) echo "Plaster001" ;;
    stone) echo "Rock023" ;;
    washi) echo "Paper001" ;;
    ground) echo "Ground037" ;;
    roof) echo "RoofingTiles012A" ;;
  esac
}

resolve_asset_id() {
  # $1 = 第一候補ID。存在すれば第一候補、404なら検索して代替IDを1件返す。
  candidate="$1"
  keyword="$2"
  check_url="https://ambientcg.com/api/v2/full_json?id=${candidate}"
  found="$($CURL "$check_url" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    a = d.get("foundAssets", [])
    print(a[0]["assetId"] if a else "")
except Exception:
    print("")
' 2>/dev/null)"
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi
  # 代替検索
  search_url="https://ambientcg.com/api/v2/full_json?type=Material&q=${keyword}&limit=5"
  $CURL "$search_url" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    a = d.get("foundAssets", [])
    print(a[0]["assetId"] if a else "")
except Exception:
    print("")
' 2>/dev/null
}

fetch_texture() {
  dir_name="$1"
  candidate_id="$(texture_candidate_id "$dir_name")"
  out_dir="$TEX_DIR/$dir_name"

  if [ -s "$out_dir/color.jpg" ] && [ -s "$out_dir/normal.jpg" ] && [ -s "$out_dir/roughness.jpg" ]; then
    log "texture: $dir_name は取得済み。スキップ。"
    return 0
  fi

  asset_id="$(resolve_asset_id "$candidate_id" "$dir_name")"
  if [ -z "$asset_id" ]; then
    log "texture: $dir_name 用のアセットが見つからず(候補 $candidate_id)。スキップ。"
    return 0
  fi
  if [ "$asset_id" != "$candidate_id" ]; then
    log "texture: $dir_name 候補 $candidate_id が見つからず、代替 $asset_id を使用。"
  fi

  log "texture: $dir_name ($asset_id) を取得中..."
  zip="$TMP_DIR/${asset_id}_1K-JPG.zip"
  if [ ! -s "$zip" ]; then
    if ! $CURL -o "$zip" "https://ambientcg.com/get?file=${asset_id}_1K-JPG.zip"; then
      log "texture: $dir_name ($asset_id) ダウンロード失敗。スキップして続行。"
      rm -f "$zip"
      return 0
    fi
  fi

  extract_dir="$TMP_DIR/extract_${asset_id}"
  rm -rf "$extract_dir"
  mkdir -p "$extract_dir"
  if ! unzip -q -o "$zip" -d "$extract_dir"; then
    log "texture: $dir_name ($asset_id) 展開失敗。スキップ。"
    return 0
  fi

  mkdir -p "$out_dir"
  color="$(find "$extract_dir" -iname '*_Color.jpg' | head -n1)"
  normal="$(find "$extract_dir" -iname '*_NormalGL.jpg' | head -n1)"
  [ -z "$normal" ] && normal="$(find "$extract_dir" -iname '*_Normal.jpg' | head -n1)"
  roughness="$(find "$extract_dir" -iname '*_Roughness.jpg' | head -n1)"
  ao="$(find "$extract_dir" -iname '*_AmbientOcclusion.jpg' | head -n1)"

  [ -n "$color" ] && cp "$color" "$out_dir/color.jpg"
  [ -n "$normal" ] && cp "$normal" "$out_dir/normal.jpg"
  [ -n "$roughness" ] && cp "$roughness" "$out_dir/roughness.jpg"
  [ -n "$ao" ] && cp "$ao" "$out_dir/ao.jpg"

  if [ -s "$out_dir/color.jpg" ]; then
    log "texture: $dir_name ($asset_id) 配置完了。"
  else
    log "texture: $dir_name ($asset_id) color.jpg が見つからず配置失敗。"
  fi
}

for dir_name in $TEXTURE_DIRS; do
  fetch_texture "$dir_name"
done

rm -rf "$TMP_DIR"
log "完了。ls -la public/hdri public/textures/* で結果を確認してください。"
