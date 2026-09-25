# Jev Tweet Radar

[English below](#english) · [中文在下方](#中文) · MIT License

UI は日本語 / 中文 / English（ブラウザ言語で自動、設定で変更可）。

X (Twitter) のタイムラインで、画面に入った各ポストを Jev（TypeSafe System One Model）に 1 回だけ問い合わせ、
**絡む価値**・**バズる** などの校正済み確率を、アバター列（縦バー・レア度の背景）で表示する Chrome 拡張。本文の下にはタグを出さない（下書き判定のみタグ行を出す）。

## インストール
1. `chrome://extensions` → 右上「デベロッパーモード」ON → 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択。
2. 拡張のオプションで TypeSafe API キーを保存。
3. x.com を開く。スクロールで表示されたポストから順に判定される（同じポストは `chrome.storage.local` にキャッシュ、再問い合わせなし）。

## 仕組み
- `content.js`：`article[data-testid="tweet"]` を IntersectionObserver で監視、表示 40% 以上で本文・著者・時刻・メディア有無を抽出して background へ。
- `background.js`：`POST https://api.typesafe.ai/v1/systemone` に `state`（投稿）と選択中の Noul 質問（`questions.js`、オプションで選択）を 1 リクエストで送信。429/529 は指数バックオフ。1 分あたりの上限はオプションで設定。
- 費用：1 判定 ≈ 300 input token ≈ $0.00001（出力は無料）。ポップアップに今日の件数と概算を表示。

## 注意
- Jev は理由を返さない。確率は「校正済み」だが判定が常に正しいわけではない。
- 投稿本文は TypeSafe に送信される。

## 目的プリセット
オプションの「私の目的」で **フォロワーを増やしたい / 学びたい / 刺激がほしい** を選ぶか、自由記述で目的を書く。目的は `state.viewer_goal` として Jev に渡され、「絡む価値」の質問文が目的基準に切り替わる（他のタグは客観判定のまま）。目的ごとにキャッシュは別。

## タイムラインのフィルタ
オプションの「タイムラインのフィルタ」で条件（例：スパム ≥ 0.7、AI臭 ≥ 0.7、絡む価値 < 0.3）を有効にすると、該当したポストは **50% の透明度** で表示され、マウスを乗せると元に戻る。条件に使うタグは表示タグから外していても問い合わせる。自分の下書きには適用しない。

## アバター列
アバターの下に **バズる**（橙）と **絡む価値**（青）の細い縦バーを出し、アバター列の背景を高い方の値でレア度表示する：75% 超 = 金（レジェンド）、60% 超 = 紫（エピック）、45% 超 = 緑（レア）、それ以外 = 白。
アバター列を 0.6 秒長押しすると **ブックマーク＋リポスト＋いいね** を一度に実行（押している間は揺れる。済みのものは取り消さない）。スパムか AI臭 が 85% を超えたポストは名前の行だけに折りたたみ（クリックで開く）、そのときの長押しは三連ではなく **その人をブロック**。バズる・スパム・AI臭は表示タグから外していても問い合わせる。

## 投稿前判定
発言欄（返信欄も）に 8 文字以上入力して 1.2 秒止まると、同じ軸で下書きを採点してツールバーの上に表示する。返信は返信先の投稿を `state.replying_to` として一緒に送り、組み合わせで判定する。

## English

Chrome extension (MV3) that scores every post on your X timeline with **one** call to [Jev](https://typesafe.ai) (TypeSafe's System One Model): *worth engaging*, plus selectable tags — *spam / buzz / flame / ignored / misread / repost-worthy / bookmark-worthy / AI-ish* — as calibrated probabilities, shown in the avatar column (vertical bars + rarity tint); no badge row under the post text (drafts still get one). Pick a goal (grow followers / learn / excitement / custom text) and *worth engaging* is judged against it. Also scores your own draft (and replies, together with the parent post) before you hit Post.

- Timeline filter: rules such as *spam ≥ 0.7* or *engage < 0.3* fade matched posts to 50% opacity; hover restores them.
- Under the avatar: two thin vertical bars (buzz / engage). The avatar column gets a rarity tint from the higher one: >75% gold, >60% purple, >45% green, else white. Long-press the column 0.6 s to bookmark + repost + like at once (it shakes while held; never undoes). Posts over 85% spam or AI-ish fold to the name line (click to expand); on those, the long press blocks the author instead.
- UI in Japanese / Chinese / English, auto-detected from the browser language, switchable in Options.
- Load unpacked from `chrome://extensions`, paste your TypeSafe API key in Options, open x.com.
- One judgment ≈ 300 input tokens ≈ $0.00001; output is free. The popup shows today's count and cost.
- Jev returns no rationale. Probabilities are calibrated, not infallible. Post text is sent to api.typesafe.ai.

## 中文

Chrome 扩展（MV3）。刷 X 时间线时，对进入视野的每条帖子只向 [Jev](https://typesafe.ai)（TypeSafe System One Model）发一次请求，用头像列（竖条 + 稀有度底色）显示 **值得互动**、**会火** 等校准概率，正文下方不再显示标签（仅发帖前判定仍显示标签行）。可选目的（涨粉 / 学习 / 找刺激 / 自定义），“值得互动”会按该目的判定。你自己的草稿（以及回复，会连同原帖一起）在点发送之前也会被判定。

- 时间线过滤：设置条件（如 垃圾 ≥ 0.7、值得互动 < 0.3），命中的帖子以 50% 透明度显示，鼠标移上去恢复。
- 头像下方显示「会火」（橙）和「值得互动」（蓝）两条细竖条；头像列按较高的那个值上稀有度底色：>75% 金色传说、>60% 紫色史诗、>45% 绿色稀有，其余白色。长按头像列 0.6 秒一键三连（收藏＋转发＋点赞，按住时抖动，已做的不会取消）。垃圾或 AI 味超过 85% 的帖子折叠成只剩名字一行（点击展开），这时长按改为屏蔽作者。
- 界面支持中文 / 日本語 / English，按浏览器语言自动选择，可在设置中切换。
- 在 `chrome://extensions` 开启开发者模式，“加载已解压的扩展程序”选择本文件夹；在设置中粘贴 TypeSafe API key；打开 x.com。
- 1 次判定 ≈ 300 input token ≈ $0.00001，output 免费。弹窗显示今日次数和费用。
- Jev 不返回理由。概率已校准但并非总是正确。帖子正文会发送到 api.typesafe.ai。
