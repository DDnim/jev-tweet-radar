# Jev Tweet Radar

X (Twitter) のタイムラインで、画面に入った各ポストを Jev（TypeSafe System One Model）に 1 回だけ問い合わせ、
**絡む価値** と選択したタグ（バズる / 炎上 / スルー / 誤解 / リポスト価値 / 保存価値 / AI臭）の校正済み確率を本文の下に表示する Chrome 拡張。

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
