# ASSETS.md — 取得アセット一覧

すべて **CC0**(パブリックドメイン相当・改変/商用利用可・帰属表示不要)のアセットのみを使用。
費用は一切発生していない。取得は `scripts/fetch-assets.sh` を実行して行う(再実行しても既存ファイルはスキップされる)。

## HDRI(Poly Haven, 2K .hdr)

同一ロケーション「Qwantani」の時間帯違いカットで揃え、朝/昼/夕/夜を切り替えても空・地平線の雰囲気に一貫性が出るようにした。

| 用途 | 配置先 | Poly Haven アセット名 | アセットID | 取得元URL | ライセンス | 作者 |
|---|---|---|---|---|---|---|
| 朝(低い太陽・柔らかい光) | `public/hdri/morning.hdr` | Qwantani Morning | `qwantani_morning` | https://polyhaven.com/a/qwantani_morning | CC0 | Jarod Guest |
| 昼(晴天) | `public/hdri/noon.hdr` | Qwantani Noon | `qwantani_noon` | https://polyhaven.com/a/qwantani_noon | CC0 | Greg Zaal, Jarod Guest |
| 夕(夕焼け) | `public/hdri/evening.hdr` | Qwantani Sunset | `qwantani_sunset` | https://polyhaven.com/a/qwantani_sunset | CC0 | Greg Zaal, Jarod Guest |
| 夜(月夜・星空) | `public/hdri/night.hdr` | Qwantani Night | `qwantani_night` | https://polyhaven.com/a/qwantani_night | CC0 | Greg Zaal, Jarod Guest |

実ダウンロードURL(解像度2K, .hdr)は `https://api.polyhaven.com/files/<asset_id>` を解決して得ている。
API解決に失敗した場合は `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/<asset_id>_2k.hdr` にフォールバックする。

## テクスチャ(ambientCG, 1K JPG)

各アセットをダウンロード・展開し、`color.jpg` / `normal.jpg`(NormalGL) / `roughness.jpg` / (存在すれば)`ao.jpg` にリネームして配置。

| 用途 | 配置先 | ambientCG アセット名 | アセットID | 取得元URL | ライセンス |
|---|---|---|---|---|---|
| 床板(木) | `public/textures/wood_floor/` | Wood Floor 051 | `WoodFloor051` | https://ambientcg.com/view?id=WoodFloor051 | CC0 |
| 濃い木(本棚・文机等) | `public/textures/wood_dark/` | Wood 051 | `Wood051` | https://ambientcg.com/view?id=Wood051 | CC0 |
| 畳の代替(織物) | `public/textures/tatami/` | Fabric 062 | `Fabric062` | https://ambientcg.com/view?id=Fabric062 | CC0 |
| 漆喰壁 | `public/textures/plaster/` | Plaster 001 | `Plaster001` | https://ambientcg.com/view?id=Plaster001 | CC0 |
| 石(庭・飛び石等) | `public/textures/stone/` | Rock 023 | `Rock023` | https://ambientcg.com/view?id=Rock023 | CC0 |
| 和紙(障子・掛け軸の紙質感代用) | `public/textures/washi/` | Paper 001 | `Paper001` | https://ambientcg.com/view?id=Paper001 | CC0 |
| 庭の土・苔 | `public/textures/ground/` | Ground 037 | `Ground037` | https://ambientcg.com/view?id=Ground037 | CC0 |
| 瓦屋根 | `public/textures/roof/` | Roofing Tiles 012 A | `RoofingTiles012A` | https://ambientcg.com/view?id=RoofingTiles012A | CC0 |

ダウンロードURL形式: `https://ambientcg.com/get?file=<AssetID>_1K-JPG.zip`。
候補IDが404の場合は `https://ambientcg.com/api/v2/full_json?type=Material&q=<用途キーワード>` で検索し代替アセットを自動選択する
(`scripts/fetch-assets.sh` の `resolve_asset_id` 関数)。

## 短歌テキスト

`public/texts/tanka.json` — 百人一首・万葉集などパブリックドメインの古典短歌(作者没後長期経過)。出典・首数は同ファイル参照。
著作権のある現代歌人の作品は使用していない。

## ライセンスまとめ

- Poly Haven のすべてのアセット(HDRI/テクスチャ/モデル)は **CC0 1.0** で配布されている(https://polyhaven.com/license)。
- ambientCG のすべてのアセットは **CC0 1.0** で配布されている(https://ambientcg.com/faq#terms)。
- 帰属表示は法的に不要だが、感謝の意味で上表に作者名・出典URLを記録している。
- 費用が発生する取得(有料素材・サブスクリプション等)は一切行っていない。
