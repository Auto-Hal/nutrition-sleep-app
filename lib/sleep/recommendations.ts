import { circularMinuteDistance, type SleepNightScore } from "@/lib/sleep/score";

export type SleepRecommendation = {
  id: string;
  category: "duration_extreme" | "duration" | "regularity" | "efficiency" | "weekend" | "stable" | "data";
  title: string;
  observation: string;
  evidence: string;
  action: string;
  steps: string[];
  expected_direction: string;
  confidence: "reference" | "limited";
  href: string;
  priority: number;
};

type RecommendationOptions = { range: 7 | 30 | 90; endDate: string; connectionStatus?: string };

// These observation thresholds are product rules, not diagnostic criteria.
const MINIMUM_NIGHTS = 3;
const MINIMUM_WINDOW_COVERAGE = 0.5;
const STALE_DAYS = 3;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string) {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function durationLabel(minutes: number) {
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}時間${rounded % 60}分`;
}

function clockLabel(minutes: number) {
  const rounded = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function enoughNights(count: number, range: number) {
  return count >= MINIMUM_NIGHTS && count / range >= MINIMUM_WINDOW_COVERAGE;
}

function confidence(nights: SleepNightScore[]): SleepRecommendation["confidence"] {
  return nights.some((night) => night.reasons.includes("provider_completion_unconfirmed") || night.reasons.includes("age_unconfirmed") || night.reasons.includes("clock_timezone_fallback"))
    ? "limited" : "reference";
}

function circularMedoid(nights: SleepNightScore[]) {
  return [...nights].map((night) => ({
    date: night.date,
    minutes: night.wake_minutes!,
    distance: nights.reduce((sum, other) => sum + circularMinuteDistance(night.wake_minutes!, other.wake_minutes!), 0),
  })).sort((a, b) => a.distance - b.distance || b.date.localeCompare(a.date))[0].minutes;
}

/**
 * Advice uses valid component observations, including provisional nights, never
 * a mixture of normalized provisional and complete total scores. Missing nights
 * are absent observations and cannot become evidence of poor sleep.
 */
export function sleepRecommendations(nights: SleepNightScore[], options: RecommendationOptions): SleepRecommendation[] {
  if (!validDate(options.endDate) || ![7, 30, 90].includes(options.range)) {
    throw new Error("睡眠提案の期間が正しくありません。");
  }
  const startDate = shiftDate(options.endDate, -(options.range - 1));
  // Score calculation emits one record per civil date. Deduplicate defensively
  // so repeated records cannot inflate the observation requirement.
  const unique = new Map<string, SleepNightScore>();
  for (const night of [...nights].sort((a, b) => a.date.localeCompare(b.date) || (b.session_id ?? "").localeCompare(a.session_id ?? ""))) {
    if (validDate(night.date) && night.date >= startDate && night.date <= options.endDate) unique.set(night.date, night);
  }
  const window = [...unique.values()];
  const latest = [...window].reverse().find((night) => night.state !== "unobserved");
  const usable = window.filter((night) => (night.state === "normal" || night.state === "provisional")
    && finite(night.minutes_asleep) && night.minutes_asleep >= 0 && finite(night.components.duration.points));
  const latestUsable = usable.at(-1);
  const href = `/sleep?range=${options.range}#sleep-score-details`;
  const period = `${startDate}〜${options.endDate}（${options.range}日間）`;
  const evidence = `${period}・主睡眠${usable.length}夜${latestUsable ? `・最新の有効記録${latestUsable.date}` : ""}`;

  function dataRecommendation(id: string, title: string, observation: string, action: string): SleepRecommendation[] {
    return [{
      id, category: "data", title, observation, evidence, action,
      steps: ["Google Healthの接続と最終同期を確認する", action, "観測された夜の主睡眠と内訳を確認する"],
      expected_direction: "比較できる睡眠記録をそろえる", confidence: "limited", href: `/sleep?range=${options.range}#sleep-connection`, priority: 0,
    }];
  }

  if (options.connectionStatus && options.connectionStatus !== "connected") {
    return dataRecommendation("connection", "睡眠データの接続を確認する", "接続・認証の問題があるため、最新の睡眠状態は確かめられません。", "接続状態を確認し、必要なら再認証して同期する");
  }
  if (latest?.reasons.includes("unsupported_age_scope")) {
    return dataRecommendation("age_scope", "年齢に合う睡眠の目安を確認する", "Sleep Score v1は成人向けです。この記録には成人向けのスコアや生活評価を適用しません。", "記録の詳細と、年齢に合った睡眠の目安を確認する");
  }
  if (!latestUsable) {
    if (latest?.state === "processing") return dataRecommendation("processing", "睡眠データの処理を待つ", `${latest.date}の主睡眠は提供元で処理中です。睡眠の良し悪しはまだ比較しません。`, "時間をおいて同期し、処理が完了した記録を確認する");
    return dataRecommendation("no_usable_nights", "主な睡眠の記録を確認する", latest?.reasons.includes("nap_only")
      ? "昼寝の記録があります。夜間の主な睡眠時間はまだ比較できません。"
      : "主な睡眠時間を比較できる記録がまだありません。未観測や欠損は、睡眠不良を意味しません。", "最近の主な睡眠が同期されているか確認する");
  }
  if (daysBetween(latestUsable.date, options.endDate) > STALE_DAYS) {
    return dataRecommendation("stale", "最近の睡眠記録を同期する", `最新の有効記録は${latestUsable.date}です。最近の睡眠を確かめるため、生活習慣の提案を保留しています。`, "最終同期と最近の記録を確認し、再同期する");
  }
  if (!enoughNights(usable.length, options.range)) {
    return dataRecommendation("insufficient_nights", "睡眠の傾向を確認する記録を集める", `この期間に比較できる主睡眠は${usable.length}夜です。アプリの傾向提案には3夜以上かつ期間の半分以上の記録を使います。`, "分かる夜の睡眠時間を見ながら、記録を続ける");
  }

  const recommendations: SleepRecommendation[] = [];
  const durationMean = mean(usable.map((night) => night.minutes_asleep!));
  const extremelyShort = usable.filter((night) => night.minutes_asleep! < 240).length;
  const base = { evidence, confidence: confidence(usable), href };
  const durationAction = "今夜は就寝準備を20〜30分早め、眠気に合わせて休める時間を確保する";

  if (extremelyShort >= MINIMUM_NIGHTS && extremelyShort >= usable.length / 2) {
    recommendations.push({
      ...base, id: "duration_extreme", category: "duration_extreme", priority: 10,
      title: "短い睡眠が続いている記録を確認する",
      observation: `主睡眠${usable.length}夜のうち${extremelyShort}夜が4時間未満です。計測や生活の状況を確かめ、睡眠時間の確保を優先しましょう。`,
      action: durationAction, steps: ["短い記録が実際の睡眠と合っているか確認する", durationAction, "日中の眠気や休養感も確認する"],
      expected_direction: "主な睡眠に使える時間を増やす",
    });
  } else if (durationMean < 360) {
    recommendations.push({
      ...base, id: "duration", category: "duration", priority: 20, title: "睡眠時間を確保する工夫を試す",
      observation: `記録された主睡眠の平均は${durationLabel(durationMean)}です。成人の基本的な目安である6時間を下回っています。`,
      action: durationAction, steps: ["就寝前の予定から短くできることを一つ選ぶ", durationAction, "次の記録で睡眠時間と日中の調子を確認する"],
      expected_direction: "主な睡眠に使える時間を増やす",
    });
  } else if (durationMean < 420) {
    recommendations.push({
      ...base, id: "duration_reference", category: "duration", priority: 60, title: "睡眠時間と日中の調子を確認する",
      observation: `主睡眠は平均${durationLabel(durationMean)}です。6時間以上の基本的な目安に達しています。成人向けの7時間以上という推奨も参考に、個人差や休養感を確認しましょう。`,
      action: "日中の眠気や休養感を見ながら、就寝準備を少し早められるか試す",
      steps: ["睡眠時間と日中の眠気・休養感を一緒に振り返る", "必要なら就寝準備を少し早める", "同じ条件で次の期間も確認する"],
      expected_direction: "自分に必要な睡眠時間を確かめる",
    });
  }

  const regularity = usable.filter((night) => finite(night.wake_deviation_minutes)
    && night.wake_deviation_minutes >= 0 && night.wake_deviation_minutes <= 720 && finite(night.components.regularity.points));
  const regularityEnough = enoughNights(regularity.length, options.range);
  const wakeDeviation = regularity.length ? median(regularity.map((night) => night.wake_deviation_minutes!)) : null;
  if (regularityEnough && wakeDeviation !== null && wakeDeviation > 45) {
    recommendations.push({
      ...base, confidence: confidence(regularity), id: "regularity", category: "regularity", priority: 30, title: "起床時刻の目安をそろえる",
      observation: `比較できる${regularity.length}夜で、起床時刻とそれ以前の基準時刻とのずれの中央値は${Math.round(wakeDeviation)}分です。`,
      evidence: `${evidence}・規則性の比較${regularity.length}夜（同じUTCオフセットの過去記録を基準に計算）`,
      action: "生活に合う起床時刻の目安を決め、日ごとの差を小さくする工夫を試す",
      steps: ["日別グラフで起床時刻を確認する", "無理のない起床時刻の目安を決める", "次の期間も起床時刻のずれを確認する"],
      expected_direction: "起床時刻の日ごとの差を小さくする",
    });
  }

  const efficiencies = usable.filter((night) => finite(night.efficiency_percent) && night.efficiency_percent >= 0
    && night.efficiency_percent <= 100 && finite(night.components.efficiency.points));
  const efficiencyEnough = enoughNights(efficiencies.length, options.range);
  const lowEfficiency = efficiencies.filter((night) => night.efficiency_percent! < 85).length;
  const efficiencyMean = efficiencies.length ? mean(efficiencies.map((night) => night.efficiency_percent!)) : null;
  if (efficiencyEnough && lowEfficiency >= MINIMUM_NIGHTS && lowEfficiency >= efficiencies.length / 2) {
    recommendations.push({
      ...base, confidence: confidence(efficiencies), id: "efficiency", category: "efficiency", priority: 40, title: "眠る環境と就寝前の過ごし方を見直す",
      observation: `計測上の睡眠効率は平均${Math.round(efficiencyMean!)}%で、${efficiencies.length}夜中${lowEfficiency}夜がアプリの参考値85%未満です。ウェアラブルによる推定値です。`,
      evidence: `${evidence}・睡眠効率の比較${efficiencies.length}夜`,
      action: "寝室の光・音・温度や、就寝前に落ち着いて過ごせる環境を一つ見直す",
      steps: ["計測された主睡眠と覚醒の記録を確認する", "光・音・温度から調整できることを一つ選ぶ", "次の記録と休養感を一緒に確認する"],
      expected_direction: "眠りやすい環境を整え、計測上の覚醒時間の変化を確認する",
    });
  }

  const clockGroups = new Map<string, SleepNightScore[]>();
  for (const night of usable) {
    if (!finite(night.utc_offset_seconds) || !finite(night.wake_minutes) || night.wake_minutes < 0 || night.wake_minutes >= 1440) continue;
    const clockKey = `${night.utc_offset_seconds}:${night.reasons.includes("clock_timezone_fallback") ? "profile" : "stored"}`;
    const group = clockGroups.get(clockKey) ?? [];
    group.push(night);
    clockGroups.set(clockKey, group);
  }
  const comparable = [...clockGroups.values()].sort((a, b) => b.length - a.length || b.at(-1)!.date.localeCompare(a.at(-1)!.date))[0] ?? [];
  const isWeekend = (night: SleepNightScore) => [0, 6].includes(new Date(`${night.date}T00:00:00Z`).getUTCDay());
  const weekend = comparable.filter(isWeekend);
  const weekdays = comparable.filter((night) => !isWeekend(night));
  if (enoughNights(comparable.length, options.range) && weekend.length >= 2 && weekdays.length >= 2) {
    const weekendWake = circularMedoid(weekend);
    const weekdayWake = circularMedoid(weekdays);
    const difference = ((weekendWake - weekdayWake + 2160) % 1440) - 720;
    if (Math.abs(difference) >= 60) {
      const weekdayDuration = mean(weekdays.map((night) => night.minutes_asleep!));
      const weekendDuration = mean(weekend.map((night) => night.minutes_asleep!));
      recommendations.push({
        ...base, confidence: "limited", id: "weekend", category: "weekend", priority: 50, title: "週末と平日の睡眠リズムを比べる",
        observation: `起床時刻の代表値は平日${clockLabel(weekdayWake)}、土日${clockLabel(weekendWake)}で、土日は${Math.round(Math.abs(difference))}分${difference > 0 ? "遅め" : "早め"}です。主睡眠の平均は平日${durationLabel(weekdayDuration)}、土日${durationLabel(weekendDuration)}です。`,
        evidence: `${evidence}・同じUTCオフセットの平日${weekdays.length}夜と土日${weekend.length}夜。土日を休日の代理としており、実際の休日は未取得です。`,
        action: weekdayDuration < 420 && difference > 0
          ? "平日に睡眠時間を確保できるか見直し、週末も生活に合う起床時刻の目安を決める"
          : "実際の仕事・休日の予定に合わせて、起床時刻の日ごとの差を小さくできるか確認する",
        steps: ["実際の仕事・休日と記録の日付を照らし合わせる", "平日の睡眠時間と週末の起床時刻を別々に確認する", "生活に合う起床時刻の目安を決める"],
        expected_direction: "平日の睡眠時間を確保し、生活リズムの差を小さくする",
      });
    }
  }

  if (recommendations.length === 0) {
    if (durationMean >= 420 && regularityEnough && wakeDeviation !== null && wakeDeviation <= 45
      && efficiencyEnough && efficiencyMean !== null && efficiencyMean >= 85) {
      recommendations.push({
        ...base, id: "stable", category: "stable", priority: 90, title: "今の睡眠時間と生活リズムを続ける",
        observation: `主睡眠は平均${durationLabel(durationMean)}で、比較できる起床時刻と計測上の睡眠効率も比較的安定しています。`,
        action: "今の睡眠時間と起床の目安を保ち、日中の休養感も確認する",
        steps: ["無理なく続けられている生活リズムを保つ", "日中の眠気や休養感も確認する", "次の期間も同じ条件で振り返る"],
        expected_direction: "無理なく続けられる睡眠習慣を維持する",
      });
    } else {
      return dataRecommendation("partial_evidence", "分かる項目から睡眠を振り返る", `主睡眠は平均${durationLabel(durationMean)}です。分かる項目は参考にできますが、全体が安定しているか、課題が続いているかをまとめて判断するには情報が足りません。`, "分かる夜の睡眠時間と起床時刻を確認し、同期と記録を続ける");
    }
  }
  return recommendations.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
