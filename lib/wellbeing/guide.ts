import type { NutritionReviewResult } from "@/lib/nutrition/review-priority";
import type { getSleepAnalytics } from "@/lib/sleep/analytics";
import type { SleepRecommendation } from "@/lib/sleep/recommendations";

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

/** The score UI uses main-night evidence. Keep the legacy guide API for callers
 * outside that flow; it is never used to gate the new score or its advice. */
export function sleepScoreGuide(recommendation: SleepRecommendation): Guide {
  return { domain: "sleep", title: recommendation.title, observation: recommendation.observation,
    evidence: recommendation.evidence, action: recommendation.action, steps: recommendation.steps,
    href: recommendation.href, limited: recommendation.confidence === "limited" };
}

export function nutritionGuide(review: NutritionReviewResult): Guide {
  const item = [
    ...review.sections.excess_alert,
    ...review.sections.review_first,
    ...review.sections.review,
  ].find((candidate) => candidate.primary?.evidence_eligible);
  if (!item?.primary) {
    const hasEvidence = review.sections.within_reference.some((candidate) => candidate.primary?.evidence_eligible);
    const hasPartial = review.items.some((candidate) => candidate.primary?.evidence_basis === "partial");
    const reference = review.sections.watch.find((candidate) => candidate.primary?.evidence_eligible && candidate.primary.state === "ear_to_rda");
    const shortObservation = review.sections.watch.find((candidate) => candidate.primary?.trend_limited
      && candidate.primary.evidence_eligible && ["below_ear", "below_dg", "above_dg"].includes(candidate.primary.state));
    if (shortObservation?.primary) {
      return {
        domain: "nutrition", title: `${shortObservation.label}の記録値を確認`,
        observation: `${shortObservation.primary.summary}。記録日数が少ないため、長期の食生活全体の傾向とは区別してください。`,
        evidence: `直近${review.range}日・記録した${shortObservation.primary.evaluable_days}日の比較`,
        action: "食品の内訳と栄養値を確認し、記録を続ける",
        steps: ["詳細で比較に使った値と基準を見る", "食品の量と、栄養値の出典を確認する", "同じ期間の記録を続け、傾向を比較する"],
        href: `/nutrition?range=${review.range}&nutrient=${shortObservation.nutrient_code}#detail`, limited: true,
      };
    }
    if (reference?.primary) {
      return {
        domain: "nutrition",
        title: "推奨量との差を参考に、経過を見る",
        observation: "記録平均はEAR以上・RDA未満です。推奨量との差だけで不足や追加摂取の必要量は判断しません。",
        evidence: `直近${review.range}日・${reference.label}の対象記録${reference.primary.evaluable_days}日`,
        action: "今の食事を記録し、次の期間も同じ基準で比較する",
        steps: ["詳細で推奨量との差と食品の内訳を確認する", "栄養値の品質と、未判明分がないかを確認する", "記録を続け、同じ期間の傾向を比べる"],
        href: `/nutrition?range=${review.range}&nutrient=${reference.nutrient_code}#detail`,
        limited: true,
      };
    }
    const known = review.sections.known_intake[0];
    if (known?.primary?.known_reference) {
      const comparison = known.primary.known_reference;
      const followup = known.missing_value_followup;
      if (known.primary.evidence_basis === "complete") {
        return {
          domain: "nutrition", title: `${known.label}の記録平均と基準を確認`,
          observation: `記録平均は${comparison.label}の${comparison.ratio_percent}%です。栄養値は揃っていますが、総合した判断に必要な比較基準を期間全体で確定できません。`,
          evidence: `直近${review.range}日・栄養値が揃う対象記録${known.primary.evaluable_days}日`,
          action: "詳細で期間内の比較基準を確認する",
          steps: ["詳細で期間内の年齢区分や比較基準の変化を確認する", "日別の比較結果と、期間全体の記録平均を分けて見る", "比較できない基準から過不足を判断しない"],
          href: `/nutrition?range=${review.range}&nutrient=${known.nutrient_code}#detail`, limited: true,
        };
      }
      return {
        domain: "nutrition", title: `${known.label}の既知分と基準を確認`,
        observation: `既知分で${comparison.label}の少なくとも${comparison.ratio_percent}%を記録しています。未判明分があるため、食事全体の到達や不足はまだ判断できません。`,
        evidence: `直近${review.range}日・対象記録${known.primary.evaluable_days}日・未判明の食品記録${known.primary.missing_entries ?? 0}件`,
        action: "未判明の食品を1つ選び、成分表示や出典を確認する",
        steps: ["未判明の食品を開き、栄養値と単位を確認する", "値が分かる場合は、出典を残して食品を修正する。不明は0にしない", "食品の編集だけでは過去の記録は変わらないため、必要なら食事履歴も明示的に修正する"],
        href: followup ? `/nutrition?range=${review.range}&nutrient=${known.nutrient_code}&day=${followup.date}#day-detail`
          : `/nutrition?range=${review.range}&nutrient=${known.nutrient_code}#detail`,
        limited: true,
      };
    }
    const attainment = review.sections.watch.find((candidate) => candidate.primary?.evidence_eligible
      && ["at_or_above_rda", "at_or_above_ai", "within_dg"].includes(candidate.primary.state));
    if (attainment?.primary) {
      return {
        domain: "nutrition", title: `${attainment.label}の基準到達を確認`,
        observation: attainment.primary.summary,
        evidence: `直近${review.range}日・対象記録${attainment.primary.evaluable_days}日${attainment.primary.trend_limited ? "・短い記録の参考比較" : ""}`,
        action: "摂れている食品と未判明分を確認し、記録を続ける",
        steps: ["基準到達の根拠となる食品を見る", "到達確認とは別に、未判明値や上限の比較を確認する", "記録を続けて、次の期間の傾向を見る"],
        href: `/nutrition?range=${review.range}&nutrient=${attainment.nutrient_code}#detail`, limited: true,
      };
    }
    const unresolved = review.sections.insufficient_evidence.find((candidate) => candidate.primary?.evidence_basis !== undefined
      && candidate.primary.evaluable_days > 0);
    if (unresolved?.primary) {
      const noAmount = unresolved.primary.value === null;
      const followup = unresolved.missing_value_followup;
      if (unresolved.primary.unit === "percent_energy") {
        return {
          domain: "nutrition", title: `${unresolved.label}とエネルギーの未判明分を確認`,
          observation: "栄養素またはエネルギーに未判明分があるため、食事全体の比率が目標範囲内かは未確定です。g量の目安と比率の判定は別です。",
          evidence: `直近${review.range}日・比率の対象記録${unresolved.primary.evaluable_days}日`,
          action: "栄養素とエネルギーの値を別々に確認する",
          steps: ["詳細で比率の範囲と、分子・分母の欠損を確認する", "同じ食事の栄養素とエネルギーを出典に沿って確認する", "分からない値を0にせず、必要なら食事履歴も明示的に修正する"],
          href: `/nutrition?range=${review.range}&nutrient=${unresolved.nutrient_code}#detail`, limited: true,
        };
      }
      return {
        domain: "nutrition", title: `${unresolved.label}の${noAmount ? "未判明値" : "比較基準"}を確認`,
        observation: noAmount ? "食事は記録されていますが、この栄養素の量はまだ分かりません。未判明値は0ではありません。"
          : "既知分は記録されていますが、比較に必要な基準や栄養素の定義を確定できません。",
        evidence: `直近${review.range}日・対象記録${unresolved.primary.evaluable_days}日`,
        action: noAmount ? "登録済み食品の栄養値と出典を確認する" : "詳細の比較条件とプロフィールを確認する",
        steps: noAmount ? ["未判明の食品と元の表示を確認する", "分かる値は単位と出典を残し、不明は0にしない", "食品の修正後、必要なら食事履歴も明示的に修正する"]
          : ["詳細で比較できない理由と対象成分を確認する", "プロフィールと、登録した栄養素の定義・単位を確認する", "比較できない基準から過不足を判断しない"],
        href: noAmount && followup ? `/nutrition?range=${review.range}&nutrient=${unresolved.nutrient_code}&day=${followup.date}#day-detail`
          : `/nutrition?range=${review.range}&nutrient=${unresolved.nutrient_code}#detail`, limited: true,
      };
    }
    return {
      domain: "nutrition",
      title: hasEvidence ? "食事の傾向を続けて確認" : hasPartial ? "分かっている量と不明な値を確認" : "まず食事の記録をそろえる",
      observation: hasEvidence ? "評価できた項目の記録平均は基準に到達・範囲内です。栄養状態の適正を確定するものではありません。" : hasPartial ? "部分データにも既知量があります。少ない既知量だけでは不足と判断できません。" : "いまの記録だけでは、見直す栄養素を絞れません。",
      evidence: `直近${review.range}日・栄養素ごとに評価日数を確認`,
      action: hasEvidence ? "日別の記録と、不明な栄養値を確認する" : "朝・昼・夕の記録と、不明な栄養値を確認する",
      steps: ["食べたものを記録する。欠食は欠食として残す", "ラベルなどで分かる栄養値を補う", "同じ期間の評価平均で傾向を見る"],
      href: `/nutrition?range=${review.range}`,
      limited: !hasEvidence || review.sections.within_reference.some((candidate) => candidate.primary?.trend_limited),
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
          ? `${item.primary.evidence_basis === "partial" ? "登録値の既知分だけでも" : "記録平均が"}耐容上限量の基準を上回っています。元の量と出典を確認してください。`
          : item.primary.state === "below_dg"
            ? "記録平均が、目標範囲の下限を下回っています。"
            : item.primary.state === "above_dg"
              ? "記録平均が、目標範囲の上限を上回っています。"
              : item.primary.summary,
    evidence: `直近${review.range}日中、評価できた${item.primary.evaluable_days}日${item.primary.quality === "user_verified" ? "・確認済みの値" : "・未確認の値を含むため確認が必要"}`,
    action,
    steps: ["詳細で食品・サプリと元の栄養値を確認する", action, "記録を続け、次の7日間も同じ基準で比較する"],
    href: `/nutrition?range=${review.range}&nutrient=${item.nutrient_code}#detail`,
    limited: item.primary.trend_limited === true || item.primary.quality !== "user_verified",
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
