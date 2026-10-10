import type { NutritionReviewResult } from "@/lib/nutrition/review-priority";
import type { getSleepAnalytics } from "@/lib/sleep/analytics";

export type Guide = {
  domain: "nutrition" | "sleep";
  title: string;
  observation: string;
  evidence: string;
  action: string;
  steps: string[];
  href: string;
  limited: boolean;
};

export function nutritionGuide(review: NutritionReviewResult): Guide {
  const item = [
    ...review.sections.excess_alert,
    ...review.sections.review_first,
    ...review.sections.review,
  ].find((candidate) => candidate.primary?.evidence_eligible);
  if (!item?.primary) {
    const hasEvidence = review.sections.within_reference.some((candidate) => candidate.primary?.evidence_eligible);
    return {
      domain: "nutrition",
      title: hasEvidence ? "食事の傾向を続けて確認" : "まず食事の記録をそろえる",
      observation: hasEvidence ? "評価できた項目は基準に到達・範囲内です。" : "いまの記録だけでは、見直す栄養素を絞れません。",
      evidence: `直近${review.range}日・栄養素ごとに評価日数を確認`,
      action: hasEvidence ? "日別の記録と、不明な栄養値を確認する" : "朝・昼・夕の記録と、不明な栄養値を確認する",
      steps: ["食べたものを記録する。欠食は欠食として残す", "ラベルなどで分かる栄養値を補う", "同じ期間の評価平均で傾向を見る"],
      href: `/nutrition?range=${review.range}`,
      limited: !hasEvidence,
    };
  }
  const alert = item.band === "excess_alert";
  const action = alert
    ? "摂取源と、製品の表示量・重複を確認する"
    : item.direction === "mixed"
      ? "複数の基準と摂取源を確認してから献立を見直す"
      : item.direction === "increase"
        ? "摂取源を確認し、次の献立で取り入れる食品を1つ選ぶ"
        : "量の多い摂取源を確認し、次の献立で1つ見直す";
  return {
    domain: "nutrition",
    title: `${item.label}の摂取源を見直す`,
    observation: item.primary.state === "below_ear"
      ? "記録平均が、必要量を考えるための基準（推定平均必要量）を下回っています。"
      : item.primary.state === "ear_to_rda"
        ? "記録平均は推定平均必要量以上で、推奨量の基準には届いていません。"
        : item.primary.state === "above_ul"
          ? "記録平均が耐容上限量の基準を上回っています。元の量と出典を確認してください。"
          : item.primary.state === "below_dg"
            ? "記録平均が、目標範囲の下限を下回っています。"
            : item.primary.state === "above_dg"
              ? "記録平均が、目標範囲の上限を上回っています。"
              : item.primary.summary,
    evidence: `直近${review.range}日中、評価できた${item.primary.evaluable_days}日${item.primary.quality === "user_verified" ? "・確認済みの値" : "・未確認の値を含むため確認が必要"}`,
    action,
    steps: ["詳細で食品・サプリと元の栄養値を確認する", action, "記録を続け、次の7日間も同じ基準で比較する"],
    href: `/nutrition?range=${review.range}&nutrient=${item.nutrient_code}#detail`,
    limited: item.primary.quality !== "user_verified",
  };
}

export function sleepGuide(analytics: Awaited<ReturnType<typeof getSleepAnalytics>>, connection?: { status: string }): Guide {
  const complete = analytics.daily.filter((day) => day.minutes_asleep_complete && day.minutes_asleep !== null);
  const latest = complete.at(-1);
  const base = {
    domain: "sleep" as const,
    href: `/sleep?range=${analytics.range}`,
    evidence: `直近${analytics.range}日中、睡眠時間が分かる${complete.length}日`,
  };
  // Missing recent nights must not become a claim about the user's current state.
  if ((connection && connection.status !== "connected") || !latest || latest.date !== analytics.end_date || complete.length < 3) {
    return {
      ...base,
      title: "睡眠の記録を確認する",
      observation: connection && connection.status !== "connected"
        ? "睡眠データの接続・認証を確認する必要があります。"
        : latest ? `最新の完全な睡眠時間は${latest.date}の記録です。` : "睡眠時間を比較できる記録がまだありません。",
      action: "接続・最終同期と、最近の睡眠時間を確認する",
      steps: ["睡眠データの接続・最終同期を確認する", "未観測の日を0時間として扱わず、記録をそろえる", "時間と就寝・起床のリズムを比較する"],
      limited: true,
    };
  }
  const previous = complete.slice(0, -1);
  const baseline = previous.reduce((sum, day) => sum + (day.minutes_asleep ?? 0), 0) / previous.length;
  const difference = Math.round(baseline - (latest.minutes_asleep ?? 0));
  const shorter = difference >= 60;
  const variable = analytics.timing_eligible_days >= 3 && (analytics.wake_variability_minutes ?? 0) >= 60;
  const action = shorter
    ? "今夜、睡眠のための時間を確保できるか見直す"
    : variable ? "生活に合う起床時刻の目安を決める" : "今の睡眠時間とリズムを続けて確認する";
  return {
    ...base,
    title: shorter ? "睡眠時間の変化を確認" : variable ? "起床時刻のばらつきを確認" : "睡眠の傾向を確認",
    observation: shorter
      ? `${latest.date}の合計睡眠時間は、それ以前の記録平均より${difference}分短くなっています。`
      : variable ? `起床時刻のばらつき（標準偏差）は${Math.round(analytics.wake_variability_minutes ?? 0)}分です。` : "睡眠時間と就寝・起床時刻を、日別に振り返れます。",
    action,
    steps: ["日別で睡眠時間と就寝・起床時刻を見る", action, "次の7日間の時間・リズムを同じ条件で比べる"],
    limited: false,
  };
}
