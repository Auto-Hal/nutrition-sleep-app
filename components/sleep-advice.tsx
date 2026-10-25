import Link from "next/link";
import type { Route } from "next";
import type { SleepRecommendation } from "@/lib/sleep/recommendations";

function confidenceLabel(value: SleepRecommendation["confidence"]) {
  return value === "reference" ? "観測記録からの参考提案" : "記録条件に制約がある参考提案";
}

export function SleepAdvice({ recommendations }: { recommendations: SleepRecommendation[] }) {
  const [primary, ...remaining] = recommendations;
  if (!primary) return null;
  return <section className="card action-guide sleep-advice-card" data-domain="sleep" aria-labelledby="sleep-advice-title">
    <div className="section-heading"><p className="eyebrow">睡眠から見直す</p>{primary.category === "data" ? <span className="pill pending">記録の確認が先</span> : <span className="pill">最優先の提案</span>}</div>
    <h2 id="sleep-advice-title">{primary.title}</h2>
    <p className="guide-observation">{primary.observation}</p>
    <p className="nutrition-meta">根拠：{primary.evidence}</p>
    <div className="guide-next"><span className="eyebrow">次にすること</span><strong>{primary.action}</strong><Link className="button" href={primary.href as Route}>記録と根拠を見る <span aria-hidden="true">→</span></Link></div>
    <details className="inline-help guide-steps"><summary>改善の進め方・提案の根拠</summary><p className="nutrition-meta">{confidenceLabel(primary.confidence)}。病気の診断や、改善の保証ではありません。</p><ol>{primary.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol><p>目指す方向：{primary.expected_direction}</p>
      {remaining.length ? <div className="sleep-next-advice"><h3>次に確認すること</h3>{remaining.map((item) => <article key={item.id}><h4>{item.title}</h4><p>{item.observation}</p><p className="nutrition-meta">根拠：{item.evidence} · {confidenceLabel(item.confidence)}</p><p><strong>{item.action}</strong></p><ol>{item.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol><p className="nutrition-meta">目指す方向：{item.expected_direction}</p><Link className="text-link" href={item.href as Route}>詳しい記録を見る →</Link></article>)}</div> : null}
    </details>
    <details className="inline-help sleep-consultation"><summary>日中の眠気や気になる症状が続くとき</summary><p>睡眠スコアは睡眠障害を診断しません。十分に休む工夫をしても強い日中の眠気や睡眠の悩みが続く場合、いびき・無呼吸を指摘された場合などは、医療機関や適切な専門家に相談してください。</p></details>
  </section>;
}
