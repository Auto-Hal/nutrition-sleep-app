import type { Route } from "next";
import Link from "next/link";
import type { Guide } from "@/lib/wellbeing/guide";

export function ActionGuide({ guide }: { guide: Guide }) {
  return (
    <section className="card action-guide" aria-labelledby={`${guide.domain}-guide-title`}>
      <div className="section-heading">
        <p className="eyebrow">{guide.domain === "nutrition" ? "食事から見直す" : "睡眠から見直す"}</p>
        {guide.limited && <span className="pill pending">記録の確認が先</span>}
      </div>
      <h2 id={`${guide.domain}-guide-title`}>{guide.title}</h2>
      <p className="guide-observation">{guide.observation}</p>
      <p className="nutrition-meta">根拠：{guide.evidence}</p>
      <div className="guide-next">
        <span className="eyebrow">次にすること</span>
        <strong>{guide.action}</strong>
        <Link className="button" href={guide.href as Route}>記録と根拠を見る <span aria-hidden="true">→</span></Link>
      </div>
      <details className="inline-help guide-steps">
        <summary>改善の進め方</summary>
        <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      </details>
    </section>
  );
}
