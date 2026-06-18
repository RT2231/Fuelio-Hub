# Fuelio Hub - デプロイ手順

燃費管理Webアプリです。
- **バックエンド（API）**: Cloudflare Workers + D1（設定はCloudflare Webダッシュボードで行う前提）
- **フロントエンド**: Vercel（GitHubリポジトリと連携して自動デプロイ）

## 構成
- **フロントエンド**: `pages/` フォルダ → Vercel にデプロイ（GitHub連携）
- **バックエンド**: `worker/` フォルダ → Cloudflare Workers にデプロイ
- **データベース**: Cloudflare D1（SQLite）

---

## 1. D1データベースを作成

1. Cloudflareダッシュボード → **Workers & Pages** → **D1 SQL Database** → **Create**
2. データベース名: `fuelio-hub-db`（任意）
3. 作成後、**Console** タブを開き、`worker/schema.sql` の中身を全部貼り付けて実行
   - もしくは **Settings** → ファイルアップロード機能があればそれでschema.sqlを実行
4. 作成されたデータベースの **Database ID**（UUID形式）をメモ
5. `worker/wrangler.toml` 内の `database_id = "YOUR_D1_DATABASE_ID"` を、メモしたIDに書き換えてGitHubにpush
   - これを行わないと、手順2のWorkerデプロイ時に `wrangler deploy` がエラーになります
   - pushしたあとも、手順2でダッシュボードからD1バインディングを設定し直せば、そちらの設定が優先されます（二重で安全）

---

## 2. Workerをデプロイ（GitHub連携 / Workers Builds）

GitHubにpushするだけで自動デプロイされる方式です。

### Workerの作成とGitHub連携

1. Cloudflareダッシュボード → **Workers & Pages** → **Create** → **Workers** タブ
2. **Import a repository**（または「Connect to Git」）を選択
3. GitHubと連携し、リポジトリ `RT2231/Fuelio-Hub` を選択
4. **Root directory**（モノレポ設定）に `worker` と入力
   - これによりこのフォルダだけをWorkerのソースとして扱います
5. **Build command**: 空欄でOK（TypeScriptはwranglerが処理します）
6. **Deploy command**: `npx wrangler deploy`
7. Worker名: `fuelio-hub-api`（任意の名前でも可、後でURLに反映されます）
8. **Save and Deploy**

初回デプロイ後、`https://fuelio-hub-api.<あなたのサブドメイン>.workers.dev` のようなURLが発行されます。これをメモしてください。

### D1バインディングの設定（ダッシュボード操作）

1. 作成したWorkerの **Settings** → **Bindings** → **Add binding**
2. **D1 Database** を選択
3. Variable name: `DB`
4. 対象データベース: 手順1で作成した `fuelio-hub-db`
5. **Save**（保存後、自動的に再デプロイされます）

### 環境変数の設定（ダッシュボード操作）

同じ **Settings** → **Variables** で以下を追加:

| 変数名 | 値 | 設定方法 |
|---|---|---|
| `JWT_SECRET` | ランダムな長い文字列（32文字以上推奨。例: `openssl rand -hex 32` で生成） | ✅ 必ず**Encrypt（Secret化）**をONにする |
| `FRONTEND_URL` | VercelのURL（例: `https://fuelio-hub.vercel.app`、末尾スラッシュなし） | 通常のVariableでOK |

> **重要**: `JWT_SECRET`や`AUTODEV_API_KEY`のような機密情報は、`worker/wrangler.toml`の`[vars]`セクションに**名前すら書かないでください**。同じ名前の変数が`wrangler.toml`の`[vars]`に存在すると、GitHubへのpushで再デプロイが走るたびに、その値でダッシュボードのSecretが上書き・無効化されてしまいます（Cloudflare/Wranglerの仕様）。このリポジトリの`wrangler.toml`は機密変数名を含まない構成にしているので、そのまま使えば問題ありません。
>
> `wrangler.toml` には `keep_vars = true` を設定済みです。これは`FRONTEND_URL`のような非機密のVariableが、GitHub経由の再デプロイで上書きされないようにする設定です。

### 以後の更新

このリポジトリの `worker/` フォルダに変更をpushするたびに、Workers Buildsが自動的に再デプロイします。

---

## 3. フロントエンドをVercelにデプロイ（GitHub連携）

1. このリポジトリをGitHubにpush
2. [Vercel](https://vercel.com) にログイン → **Add New** → **Project** → 対象のGitHubリポジトリを選択 → **Import**
3. プロジェクト設定:
   - **Framework Preset**: `Other`
   - **Root Directory**: そのまま（リポジトリ直下に `vercel.json` がある状態）
   - **Build Command**: 空欄のまま（`vercel.json` で `buildCommand: null` を指定済み）
   - **Output Directory**: 自動で `pages` が使われます（`vercel.json` 指定済み）
4. **Deploy** をクリック
5. デプロイ完了後に発行されるURL（例: `https://fuelio-hub.vercel.app`）を確認

以後はGitHubに `git push` するだけで、Vercelが自動的に再デプロイします。

### フロントエンドのAPI接続先を設定

`pages/js/config.js` の以下の行を、実際のWorkerのURLに変更してからGitHubにpushしてください:

```js
const CONFIG = {
  API_BASE: 'https://fuelio-hub-api.YOUR_SUBDOMAIN.workers.dev/api/v1',
}
```

### CORS設定の確認

Worker側の環境変数 `FRONTEND_URL` を、実際のVercelのURLに設定し直してください（手順2のCloudflareダッシュボードに戻って更新）。

---

## 4. 動作確認

1. VercelのURLにアクセス（紹介LPが表示されます）
2. 「無料で始める」からログイン画面（`/login.html`）に移動し、「新規登録」タブでアカウント作成
3. 「車両管理」から車両を追加
4. 「給油記録」から給油データを入力 → 燃費が自動計算されることを確認
5. 「統計・分析」でグラフが表示されることを確認

---

## 5. Auto.dev連携（VIN自動入力・スペック確認、任意機能）

車両登録時にVIN（車両識別番号）からメーカー・モデル・年式を自動入力したり、登録済み車両のスペック詳細を確認できる機能です。[Auto.dev](https://www.auto.dev/) という外部APIを使用するため、利用には別途Auto.devのアカウントとAPIキーが必要です（有料、$0.004/コール程度）。

### 既存D1データベースへのマイグレーション

すでにD1データベースを作成・運用中の場合、`vehicles`テーブルにVIN保存用のカラムを追加する必要があります。

1. Cloudflareダッシュボード → D1データベース → **Console** タブ
2. `worker/migrations/001_add_vin.sql` の内容を貼り付けて実行

```sql
ALTER TABLE vehicles ADD COLUMN vin TEXT;
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
```

> 新規にD1をセットアップする場合は、`schema.sql`に既にVINカラムが含まれているため、この手順は不要です。

### Auto.dev APIキーの取得

1. [auto.dev/signin](https://auto.dev/signin) でアカウント作成
2. [auto.dev/dashboard](https://auto.dev/dashboard) → **API Keys** → **Create New Key**
3. 発行されたAPIキーをコピー

### Workerへの設定（ダッシュボード操作）

1. Cloudflareダッシュボード → `fuelio-hub-api` Worker → **Settings** → **Variables**
2. `AUTODEV_API_KEY` を追加し、値にコピーしたAPIキーを貼り付け
3. **Encrypt**（Secret化）を必ずONにしてください（このキーは課金に直結するため、平文保存は避けてください）
4. 保存

> `worker/wrangler.toml`には`AUTODEV_API_KEY`という名前を一切記述していません。これは、`[vars]`に同名のキーがあるとデプロイのたびにダッシュボードのSecretが上書きされてしまうためです。ダッシュボードでの設定だけが唯一の設定場所になります。

### 使い方

- 車両の新規追加・編集モーダルでVIN（17桁）を入力し「🔍 自動入力」を押すと、メーカー・モデル・年式が自動入力されます
- 「車両管理」ページで、VINを登録済みの車両には「📋 スペック」ボタンが表示され、エンジン・燃費(MPG)・トランスミッション等の詳細を確認できます
- Auto.devは現在のところ北米市場の車両データが中心です。日本国内専用車種など、VINがデータベースに存在しない場合は「見つかりませんでした」と表示されます

---

## ファイル構成

```
fuelio-hub/
├── vercel.json                # Vercel配信設定（pages/を静的サイトとして配信）
├── .gitignore
├── worker/                    # Cloudflare Workers (バックエンドAPI)
│   ├── schema.sql              # D1用スキーマ（ダッシュボードのConsoleで実行）
│   ├── migrations/
│   │   └── 001_add_vin.sql     # 既存DBにVINカラムを追加するマイグレーション
│   ├── wrangler.toml            # Worker設定（テンプレート）
│   └── src/
│       ├── index.ts             # エントリポイント
│       ├── types.ts             # 型定義
│       ├── middleware/auth.ts   # JWT認証・ハッシュ処理
│       └── routes/
│           ├── auth.ts          # 認証（登録・ログイン・プロフィール）
│           ├── vehicles.ts      # 車両管理・メンバー管理
│           ├── fuel.ts          # 給油記録（燃費自動計算ロジック含む）
│           ├── maintenance.ts   # メンテナンス記録
│           ├── stats.ts         # 統計・分析データ集計
│           ├── tokens.ts        # APIトークン発行・削除
│           ├── public.ts        # 外部公開API（トークン認証）
│           └── autodev.ts       # Auto.dev APIプロキシ（VIN検索・スペック取得）
│
└── pages/                     # Cloudflare Pages (フロントエンド)
    ├── index.html               # 紹介LP（トップページ、ログイン不要）
    ├── login.html                # ログイン・新規登録画面
    ├── app.html                 # メインアプリ（SPA構成）
    ├── favicon.svg
    ├── _headers                  # セキュリティヘッダー
    ├── css/
    │   ├── landing.css            # LP専用スタイル
    │   ├── base.css              # 共通スタイル（カラー変数等、白ベース）
    │   ├── auth.css               # 認証画面用
    │   └── app.css                # アプリ画面用（サイドバー・レスポンシブ）
    └── js/
        ├── config.js              # API接続先・定数・フォーマッタ
        ├── api.js                 # APIクライアント（fetch wrapper）
        ├── app.js                  # アプリ状態管理・ナビゲーション・車両/プロフィールモーダル
        └── pages/
            ├── dashboard.js        # ダッシュボード（グラフ・最近の記録）
            ├── fuel.js              # 給油記録一覧・CRUD・CSVエクスポート
            ├── maintenance.js       # メンテナンス記録一覧・CRUD
            ├── stats.js              # 統計・分析（詳細グラフ・CO2推定）
            ├── vehicles.js           # 車両管理・メンバー管理・APIトークン管理
            └── tokens.js              # (実装はvehicles.jsに統合、読み込み順保持用)
```

---

## 機能一覧

- メール/パスワード認証（JWT、有効期限30日）
- 複数車両管理（乗用車・バイク・EV・発電機・その他）
- 給油記録（日付・オドメーター・給油量・単価・合計金額・満タン/部分・スタンド名・天気・メモ）
- **燃費自動計算**: 前回満タン記録との距離・給油量から自動算出
- メンテナンス記録（カテゴリ別・費用・走行距離）
- 統計・分析（平均/最良/最悪燃費、月別コスト・燃費トレンド、CO2排出推定、1kmあたりコスト）
- 車両の共有（オーナー/編集者/閲覧者のロール管理）
- 外部公開APIトークン（パブリック統計・全データ閲覧用、用途別に発行可能）
- CSVエクスポート（給油記録）
- レスポンシブ対応（モバイルはボトムナビ + ハンバーガーメニュー）
- **Auto.dev連携**（任意・APIキー設定時のみ有効）: VINからメーカー・モデル・年式を自動入力、登録済み車両のスペック詳細確認

## 既知の制約・今後の拡張ポイント

- パスワードリセット（メール送信）は未実装。Cloudflareの無料枠ではメール送信サービスが別途必要なため、必要であれば追加実装をご相談ください。
- OCR機能（レシート読み取り）は設計書にありましたが、今回はスコープ外としています。Workers AIを使えば後から追加可能です。
- レート制限はAPIトークン側にカラムだけ用意していますが、実際の制限ロジックは未実装です。
