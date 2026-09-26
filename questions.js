// Shared question set (classic script, loaded with importScripts: Safari has no module service workers). Each is a Noul (yes/no → probability). One API call per post returns all six.
const QUESTIONS = {
  engage: {
    type: 'noul',
    instructions: 'この投稿は、AI・データ・ソフトウェア開発に関心がある読者にとって、返信や引用で絡む価値があるか？ 具体的な主張や情報があり、議論の余地があり、スパム・宣伝・bot・内容のない反応ではない。',
    criteria: { true: '具体的で議論の余地があり、絡む価値がある', false: '空虚・スパム・宣伝・bot・ただの反応で絡む価値がない' }
  },
  buzz: {
    type: 'noul',
    instructions: 'この投稿は広く拡散される（多くのいいね・リポストを集める）可能性が高いか？ 意外性、強い主張、有用な情報、感情を動かす要素、共有したくなるフックがあるか。',
    criteria: { true: '拡散されるフックがある', false: '平凡で拡散されにくい' }
  },
  flame: {
    type: 'noul',
    instructions: 'この投稿は炎上する（強い反発・批判・引用での攻撃を集める）可能性が高いか？ 挑発的、断定的、特定の集団を見下す、事実誤認、倫理的にグレーな内容か。',
    criteria: { true: '反発を招く要素がある', false: '反発を招く要素はない' }
  },
  ignored: {
    type: 'noul',
    instructions: 'この投稿はほとんど反応されずにスルーされる可能性が高いか？ 内容が薄い、文脈がない、誰に向けたものか不明、フックがない。',
    criteria: { true: 'スルーされそう', false: '何らかの反応は集まりそう' }
  },
  misread: {
    type: 'noul',
    instructions: 'この投稿は書き手の意図と違う意味で受け取られる（誤解される）可能性が高いか？ 皮肉が皮肉と伝わらない、主語や前提が抜けている、省略が多い、多義的な表現。',
    criteria: { true: '誤読されやすい', false: '意図が明確に伝わる' }
  },
  repost: {
    type: 'noul',
    instructions: 'この投稿は自分のフォロワーにリポスト（拡散）する価値があるか？ 情報として有用・正確そう・新しい・多くの人に関係し、宣伝や釣りではない。',
    criteria: { true: 'リポストする価値がある', false: 'リポストするほどではない' }
  },
  bookmark: {
    type: 'noul',
    instructions: 'この投稿は後で読み返すためにブックマークする価値があるか？ 手順・データ・リンク・考え方など、時間が経っても参照する価値がある内容か。一時的な話題や感想ではない。',
    criteria: { true: '後で参照する価値がある', false: '一過性で保存する価値はない' }
  },
  spam: {
    type: 'noul',
    instructions: 'この投稿はスパム・ジャンクか？ 宣伝・アフィリエイト・詐欺や副業勧誘、bot や自動投稿、フォロー乞い・いいね乞い・エンゲージメント稼ぎ、他人のコンテンツの無断コピー、無関係なハッシュタグの羅列、繰り返し投稿される定型文など、読む価値のない投稿か。',
    criteria: { true: 'スパム・ジャンクである', false: '実質のある通常の投稿' }
  },
  ai_smell: {
    type: 'noul',
    instructions: 'この投稿は生成AIが書いた文章のように見えるか？ 定型的な構成、箇条書きと絵文字の多用、「〜を解説します」「まとめると」のような無個性な言い回し、汎用的で具体性のない内容、不自然に整った文体。',
    criteria: { true: 'AIが書いたように見える', false: '人が書いたように見える' }
  }
};
const LABELS = {
  engage: { ja: '絡む価値', zh: '值得互动', en: 'Engage' },
  buzz: { ja: 'バズる', zh: '会火', en: 'Buzz' },
  flame: { ja: '炎上', zh: '炎上', en: 'Flame' },
  ignored: { ja: 'スルー', zh: '无人理', en: 'Ignored' },
  misread: { ja: '誤解', zh: '被误读', en: 'Misread' },
  repost: { ja: 'リポスト価値', zh: '值得转发', en: 'Repost-worthy' },
  bookmark: { ja: '保存価値', zh: '值得收藏', en: 'Bookmark-worthy' },
  spam: { ja: 'スパム', zh: '垃圾', en: 'Spam' },
  ai_smell: { ja: 'AI臭', zh: 'AI 味', en: 'AI-ish' }
};
// Selectable tags in display order; `engage` is always asked and shown as the main badge.
const TAG_ORDER = ['spam', 'buzz', 'flame', 'ignored', 'misread', 'repost', 'bookmark', 'ai_smell'];
const DEFAULT_TAGS = ['spam', 'buzz', 'misread', 'repost', 'bookmark', 'ai_smell'];

// Timeline filter: a matched post is shown at 50% opacity and restored on hover. `rules` is keyed by tag:
// { on, op: 'ge'|'lt', v }. A rule's tag is asked even when it is not a displayed tag, so a filter can run silently.
const DEFAULT_FILTER = {
  on: true,
  rules: {
    spam: { on: true, op: 'ge', v: 0.7 },
    ai_smell: { on: false, op: 'ge', v: 0.7 },
    flame: { on: false, op: 'ge', v: 0.7 },
    ignored: { on: false, op: 'ge', v: 0.7 },
    engage: { on: false, op: 'lt', v: 0.3 }
  }
};
function filterReasons(answers, filter) {
  if (!filter?.on) return [];
  const out = [];
  for (const [tag, r] of Object.entries(filter.rules || {})) {
    if (!r?.on) continue;
    const v = answers[tag];
    if (v == null) continue;
    if (r.op === 'lt' ? v < r.v : v >= r.v) out.push(tag);
  }
  return out;
}

// Viewer goal presets. The goal is placed in `state.viewer_goal` and rewrites the `engage` question so
// "worth engaging" is judged relative to what the viewer wants; other tags stay objective.
const GOALS = {
  grow: {
    label: { ja: 'フォロワーを増やしたい', zh: '我主要想涨粉', en: 'Grow followers' },
    text: 'フォロワーを増やしたい。影響力のある人や伸びている話題に、自分が価値を足せる返信・引用で絡み、露出とフォローにつなげたい。'
  },
  learn: {
    label: { ja: '学びたい', zh: '我主要想学习', en: 'Learn' },
    text: '学びたい。新しい知識、一次情報、具体的な経験談、深い議論のある投稿に絡んで理解を深めたい。反応稼ぎや薄い話題には興味がない。'
  },
  thrill: {
    label: { ja: '刺激がほしい', zh: '我想找些刺激', en: 'Looking for excitement' },
    text: '刺激がほしい。意外な主張、挑発的な論点、白熱している議論、思わず反応したくなる面白い投稿に絡みたい。'
  },
  custom: { label: { ja: '自分で書く', zh: '自定义', en: 'Custom' }, text: '' }
};
function engageFor(goalText) {
  if (!goalText) return QUESTIONS.engage;
  return {
    type: 'noul',
    instructions: `viewer_goal は私（読み手）の目的。その目的にとって、この投稿は返信や引用で絡む価値があるか？ スパム・宣伝・bot・内容のない反応は目的にかかわらず価値なし。目的: ${goalText}`,
    criteria: { true: '私の目的に照らして絡む価値がある', false: '私の目的に照らして絡む価値がない、またはスパム・宣伝・bot' }
  };
}
