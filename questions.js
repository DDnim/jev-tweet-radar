// Shared question set. Each is a Noul (yes/no → probability). One API call per post returns all six.
export const QUESTIONS = {
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
  ai_smell: {
    type: 'noul',
    instructions: 'この投稿は生成AIが書いた文章のように見えるか？ 定型的な構成、箇条書きと絵文字の多用、「〜を解説します」「まとめると」のような無個性な言い回し、汎用的で具体性のない内容、不自然に整った文体。',
    criteria: { true: 'AIが書いたように見える', false: '人が書いたように見える' }
  }
};
export const LABELS = {
  engage: { ja: '絡む価値', zh: '值得互动', en: 'Engage' },
  buzz: { ja: 'バズる', zh: '会火', en: 'Buzz' },
  flame: { ja: '炎上', zh: '炎上', en: 'Flame' },
  ignored: { ja: 'スルー', zh: '无人理', en: 'Ignored' },
  misread: { ja: '誤解', zh: '被误读', en: 'Misread' },
  ai_smell: { ja: 'AI臭', zh: 'AI 味', en: 'AI-ish' }
};
