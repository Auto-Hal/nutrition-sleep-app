"use client";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import type { NutritionPeriod } from "@/lib/nutrition/period";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";
import {
  currentGoalReference,
  evaluatePfcDay,
  isEvaluable,
  PFC_CODES,
  summarizePfcMonth,
  summarizePfcWeek,
  TARGET_CODES,
  type Achievement,
  type PfcDay,
  type TargetCode,
} from "@/lib/nutrition/pfc";
import {
  type Exact,
  compare,
  fraction,
  subtract,
  textDecimal,
} from "@/lib/nutrition/exact";
import { localDate, shiftIsoDate } from "@/lib/nutrition/civil-date";
import { resolveGoal } from "@/lib/nutrition/goals";
import { useNutritionPeriod } from "@/components/nutrition-period-runtime";
const LABELS: Record<TargetCode, string> = {
  energy: "カロリー",
  protein: "P たんぱく質",
  fat: "F 脂質",
  carbohydrate: "C 炭水化物",
};
const STATES: Record<Achievement | "out_of_range", string> = {
  achieved: "達成",
  below: "不足側",
  above: "超過側",
  hold: "判定保留",
  not_recorded: "未記録",
  unsynced: "未同期",
  future: "予定",
  out_of_range: "設定範囲外",
};
const CALENDAR_STATES = { ...STATES, hold: "保留", out_of_range: "範囲外" };
export function pfcAmount(value: Exact | null, places = 1) {
  return value === null
    ? "—"
    : compare(value, fraction(0n)) !== 0 && textDecimal(value, places) === "0"
      ? textDecimal(value, 8)
      : textDecimal(value, places);
}
const signed = (value: Exact | null) =>
  value && compare(value, fraction(0n)) > 0
    ? `+${pfcAmount(value)}`
    : pfcAmount(value);
function Composition({
  value,
  provisional = false,
}: {
  value: PfcDay["composition"];
  provisional?: boolean;
}) {
  return (
    <p className="pfc-composition">
      PFC構成比{provisional ? "（記録済み項目・暫定）" : ""}：
      {value?.percent
        ? PFC_CODES.map(
            (c) =>
              `${c === "protein" ? "P" : c === "fat" ? "F" : "C"} ${pfcAmount(value.percent![c])}%`,
          ).join(" / ")
        : "算出保留"}
    </p>
  );
}
export function PfcDayDetails({ day }: { day: PfcDay }) {
  const target = day.goal?.target;
  return (
    <>
      <div className="section-heading compact-heading">
        <h3>{day.meal_date}</h3>
        <span className={`pill pfc-state-${day.overall}`}>
          {STATES[day.overall]}
        </span>
      </div>
      <div className="pfc-metrics">
        {TARGET_CODES.map((c) => {
          const m = day.metrics[c],
            unit = c === "energy" ? "kcal" : "g";
          const provisional = !isEvaluable(m.state);
          return (
            <div className="pfc-metric" key={c}>
              <div>
                <strong>{LABELS[c]}</strong>
                <span className={`pill pfc-state-${m.state}`}>
                  {STATES[m.state]}
                </span>
              </div>
              <p className="pfc-value">
                {pfcAmount(m.known_amount)}{" "}
                <small>
                  / {pfcAmount(m.target)} {unit}
                </small>
              </p>
              <small>
                {provisional ? "既知分の進捗" : "目標量の達成率"}{" "}
                {pfcAmount(m.attainment_percent)}% ·{" "}
                {provisional ? "既知分−目標" : "摂取量−目標"}{" "}
                {signed(m.known_delta)} {unit}
              </small>
              <small>
                既知 {m.row.known_entry_count}/{m.row.entry_count}件
                {m.row.missing_entry_count
                  ? ` · 不明 ${m.row.missing_entry_count}件`
                  : ""}
                {m.row.incompatible_entry_count
                  ? ` · 定義未確認 ${m.row.incompatible_entry_count}件`
                  : ""}
              </small>
            </div>
          );
        })}
      </div>
      {target ? (
        <p className="muted">
          目標構成比 P {target.protein_bps / 100}% / F {target.fat_bps / 100}% /
          C {target.carbohydrate_bps / 100}% · 許容幅 ±
          {target.pfc_tolerance_bps / 100}%
        </p>
      ) : (
        <p className="notice">
          当時の目標は設定されていません。正式な達成判定は保留です。
          <Link href="/settings?view=goals">目標を設定</Link>
        </p>
      )}
      <Composition
        value={day.composition}
        provisional={!day.composition_complete}
      />
      <details className="inline-help">
        <summary>記録・計算・データ品質</summary>
        <p>
          食事記録：
          {
            {
              not_recorded: "未記録",
              partial: "記録途中",
              complete: "完了",
              complete_empty: "完了・食品記録なし",
            }[day.record_state]
          }
          。
          {day.sync_state === "server_confirmed"
            ? "サーバーの記録を確認済み。この端末以外の未送信記録は検知できません。"
            : "最新状態または未同期の変更を確認中です。"}
        </p>
        <p>
          構成比は P=4、F=9、C=4 kcal/g。PFC由来エネルギー{" "}
          {pfcAmount(day.composition?.derived_energy ?? null)}{" "}
          kcal。食品に記録されたエネルギーは別に保持します。
        </p>
        <p>
          食品の記録エネルギー−PFC由来エネルギー：
          {signed(
            day.metrics.energy.recorded_amount !== null && day.composition
              ? subtract(
                  day.metrics.energy.recorded_amount,
                  day.composition.derived_energy,
                )
              : null,
          )}{" "}
          kcal。差があっても記録値を置き換えません。
        </p>
        <p>
          推定の有無：
          {PFC_CODES.some(
            (c) => day.metrics[c].row.estimate_status === "contains_estimates",
          )
            ? "推定値を含む参考比較"
            : PFC_CODES.some(
                  (c) => day.metrics[c].row.estimate_status === "unknown",
                )
              ? "不明な由来あり"
              : "推定の申告なし"}
          。
          {PFC_CODES.some(
            (c) => day.metrics[c].row.value_quality !== "user_verified",
          )
            ? "未確認値を含みます。"
            : "登録者による値の確認済み。"}
        </p>
        {day.goal && (
          <p>
            目標版 {day.goal.version.id} · {day.goal.variant} · 適用開始{" "}
            {day.goal.version.effective_from}
          </p>
        )}
        <p>
          設定範囲からの差は数値の比較です。健康上の過剰・不足の診断や、食事摂取基準の評価とは異なります。たんぱく質が少し上回っても有害とは判定しません。次の食事も通常の目標と食品の組合せを参考にしてください。
        </p>
      </details>
    </>
  );
}
function ReferenceComparison({
  day,
  period,
}: {
  day: PfcDay;
  period: NutritionPeriod;
}) {
  const [enabled, setEnabled] = useState(false),
    [variant, setVariant] = useState<
      "default" | "training" | "rest" | undefined
    >();
  const today = localDate(period.time_zone, new Date(period.as_of));
  const current = resolveGoal(period.goals, today);
  if (day.goal || !current || day.meal_date >= today) return null;
  const ref = currentGoalReference(day, period.goals, today, variant);
  return (
    <details className="inline-help">
      <summary>現在の目標で参考比較</summary>
      <label className="check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        現在の目標と比べる（当時の目標ではありません）
      </label>
      {enabled && ref && (
        <div className="notice">
          <p>
            参考比較のみ · 参照日 {ref.reference_as_of_date} · {ref.variant}
          </p>
          {current.version.mode === "training_split" && (
            <label>
              比較する現在の区分
              <select
                value={variant ?? current.variant}
                onChange={(e) =>
                  setVariant(e.target.value as "training" | "rest")
                }
              >
                <option value="training">トレーニング日</option>
                <option value="rest">休養日</option>
              </select>
            </label>
          )}
          {TARGET_CODES.map((c) => (
            <p key={c}>
              {LABELS[c]}：参考目標 {pfcAmount(ref.metrics[c].target)} · 既知分{" "}
              {pfcAmount(ref.metrics[c].known_percent)}% · 既知分との差{" "}
              {signed(ref.metrics[c].known_delta)}
            </p>
          ))}
          <small>
            目標版 {ref.reference_goal_version_id}
            。当時の正式目標・月間達成日数・週間残量には反映しません。記録途中や欠損がある場合は既知小計だけの参考です。
          </small>
        </div>
      )}
    </details>
  );
}
function RuntimeNotice({
  error,
  available,
  refresh,
}: {
  error: string | null;
  available: boolean;
  refresh: () => Promise<void>;
}) {
  return error ? (
    <p className="error" role="status">
      {error}{" "}
      <button
        type="button"
        className="button ghost"
        onClick={() => void refresh()}
      >
        再取得
      </button>
    </p>
  ) : !available ? (
    <p className="muted" role="status">
      同期状態を確認中…既知量を表示しています。
    </p>
  ) : null;
}
export function DailyPfcCard({
  initial,
  binding,
}: {
  initial: NutritionPeriod;
  binding: OutboxBinding;
}) {
  const runtime = useNutritionPeriod(initial, binding);
  const day = evaluatePfcDay(runtime.period, initial.start_date, {
    pending: runtime.pending,
    available: runtime.available,
  });
  return (
    <section className="card pfc-daily-card" aria-label="カロリーとPFC">
      <PfcDayDetails day={day} />
      <ReferenceComparison day={day} period={runtime.period} />
      <RuntimeNotice {...runtime} />
      <Link className="button ghost" href="/nutrition?view=pfc">
        月間PFCを見る →
      </Link>
    </section>
  );
}
function SummaryCounts({
  summary,
}: {
  summary: ReturnType<typeof summarizePfcMonth>;
}) {
  return (
    <div className="pfc-counts">
      {TARGET_CODES.map((c) => (
        <div key={c}>
          <span>{LABELS[c]}</span>
          <strong>{summary.counts[c].achieved}日</strong>
          <small>判定可能 {summary.counts[c].evaluable}日</small>
        </div>
      ))}
      <div>
        <span>PFC全達成</span>
        <strong>{summary.all_achieved}日</strong>
        <small>判定可能 {summary.all_evaluable}日</small>
      </div>
      <div>
        <span>記録完了</span>
        <strong>{summary.record_complete_days}日</strong>
        <small>経過 {summary.elapsed_days}日</small>
      </div>
    </div>
  );
}
export function MonthlyPfc({
  initial,
  binding,
}: {
  initial: NutritionPeriod;
  binding: OutboxBinding;
}) {
  const runtime = useNutritionPeriod(initial, binding);
  const { period } = runtime;
  const today = localDate(period.time_zone, new Date(period.as_of));
  const days = period.days.map((d) =>
    evaluatePfcDay(period, d.meal_date, {
      pending: runtime.pending,
      available: runtime.available,
      today,
    }),
  );
  const [selected, setSelected] = useState(
    days.find((d) => d.meal_date === today)?.meal_date ??
      days.filter((d) => d.meal_date <= today).at(-1)?.meal_date ??
      days[0].meal_date,
  );
  const [month, setMonth] = useState(period.start_date.slice(0, 7));
  const summary = summarizePfcMonth(days),
    day = days.find((d) => d.meal_date === selected) ?? days[0];
  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading compact-heading">
          <h2>月間PFC</h2>
          <form action="/nutrition" className="inline-form">
            <input type="hidden" name="view" value="pfc" />
            <label>
              月
              <input
                type="month"
                name="month"
                value={month}
                max={today.slice(0, 7)}
                onChange={(e) => setMonth(e.target.value)}
                required
              />
            </label>
            <button className="button secondary" type="submit">
              表示
            </button>
          </form>
        </div>
        <SummaryCounts summary={summary} />
        <Composition value={summary.composition} />
        <p className="muted">
          P・F・Cが共に判明した記録完了 {summary.ratio_days}
          日の合計から算出。日別%の平均ではありません。
        </p>
        <details className="inline-help">
          <summary>目標構成比との比較</summary>
          <p>目標履歴もある同じ {summary.comparison_days}日で比較します。</p>
          <Composition value={summary.comparison_actual} />
          <p>
            対応する目標：
            {summary.comparison_target?.percent
              ? PFC_CODES.map(
                  (c) =>
                    `${c === "protein" ? "P" : c === "fat" ? "F" : "C"} ${pfcAmount(summary.comparison_target!.percent![c])}%`,
                ).join(" / ")
              : "算出保留"}
          </p>
        </details>
        <RuntimeNotice {...runtime} />
        <div className="pfc-calendar" aria-label="日別PFCカレンダー">
          {["月", "火", "水", "木", "金", "土", "日"].map((v) => (
            <span className="pfc-weekday" key={v}>
              {v}
            </span>
          ))}
          {Array.from(
            {
              length:
                (new Date(`${period.start_date}T00:00:00Z`).getUTCDay() || 7) -
                1,
            },
            (_, i) => (
              <span key={`blank-${i}`} />
            ),
          )}
          {days.map((d) => (
            <button
              type="button"
              className={`pfc-calendar-day pfc-state-${d.overall}`}
              key={d.meal_date}
              onClick={() => setSelected(d.meal_date)}
              aria-pressed={d.meal_date === day.meal_date}
              aria-label={`${d.meal_date} ${STATES[d.overall]}`}
            >
              <strong>{Number(d.meal_date.slice(-2))}</strong>
              <span className="pfc-mini-status">
                {PFC_CODES.map((c) => (
                  <span
                    key={c}
                    title={`${LABELS[c]} ${STATES[d.metrics[c].state]}`}
                    className={`pfc-state-${d.metrics[c].state}`}
                  >
                    {c === "protein" ? "P" : c === "fat" ? "F" : "C"}
                  </span>
                ))}
              </span>
              <small>{CALENDAR_STATES[d.overall]}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <PfcDayDetails day={day} />
        <ReferenceComparison key={day.meal_date} day={day} period={period} />
        {day.meal_date <= today && (
          <Link
            className="button secondary"
            href={`/today?date=${day.meal_date}` as Route}
          >
            この日の記録・食事量を確認
          </Link>
        )}
      </section>
      <p className="muted">
        集計タイムゾーン {period.time_zone} · サーバー取得 {period.as_of}
      </p>
    </div>
  );
}
export function WeeklyPfc({
  initial,
  binding,
}: {
  initial: NutritionPeriod;
  binding: OutboxBinding;
}) {
  const runtime = useNutritionPeriod(initial, binding),
    { period } = runtime;
  const today = localDate(period.time_zone, new Date(period.as_of));
  const days = period.days.map((d) =>
    evaluatePfcDay(period, d.meal_date, {
      pending: runtime.pending,
      available: runtime.available,
      today,
    }),
  );
  const week = summarizePfcWeek(days, today);
  const [selected, setSelected] = useState(
    days.find((d) => d.meal_date === today)?.meal_date ?? days[0].meal_date,
  );
  const day = days.find((d) => d.meal_date === selected) ?? days[0];
  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading compact-heading">
          <h2>週間帳尻合わせ</h2>
          <nav className="inline-actions" aria-label="週の移動">
            <Link
              className="button ghost"
              href={
                `/nutrition?view=week&week=${shiftIsoDate(period.start_date, -7)}` as Route
              }
            >
              ← 前週
            </Link>
            {period.end_date < today && (
              <Link
                className="button ghost"
                href={
                  `/nutrition?view=week&week=${shiftIsoDate(period.start_date, 7)}` as Route
                }
              >
                翌週 →
              </Link>
            )}
          </nav>
        </div>
        <p>
          {period.start_date}〜{period.end_date}（月〜日）
        </p>
        <p className="muted">
          目標あり {week.goal_days}/7日 · 記録完了 {week.complete_record_days}日
          · 残り {week.remaining_days}日
          {week.partial_today ? " · 本日入力中" : ""}
        </p>
        <RuntimeNotice {...runtime} />
        <div className="pfc-metrics">
          {TARGET_CODES.map((c) => {
            const m = week.metrics[c],
              unit = c === "energy" ? "kcal" : "g";
            return (
              <div className="pfc-metric" key={c}>
                <strong>{LABELS[c]}</strong>
                <p>
                  既知合計 {pfcAmount(m.known_amount)} / 週目標{" "}
                  {pfcAmount(m.weekly_target)} {unit}
                </p>
                {!m.weekly_target && (
                  <small>
                    判明している日別目標の小計{" "}
                    {pfcAmount(m.known_target_subtotal)} {unit}
                  </small>
                )}
                <small>
                  判定可能 {m.evaluable_days}日 · 栄養値不明 {m.missing_entries}
                  件 · 定義未確認 {m.incompatible_entries}件
                </small>
                <p>
                  {m.complete_week ? "週間評価可能" : "途中経過・部分評価"} ·
                  確定記録期間の設定差分 {signed(m.closed_delta)} {unit}
                </p>
                <details className="inline-help">
                  <summary>算術差分と残りの参考</summary>
                  <p>
                    週目標−既知合計 {pfcAmount(m.arithmetic_remaining)} {unit}
                    。未確認分を含むため、そのまま食べる量ではありません。
                  </p>
                  {m.reference_state === "conditional_adjustment" ? (
                    <p>
                      完了した記録だけに基づく条件付きの参考量（通常目標から±10%以内）。栄養学的な推奨量ではありません。
                    </p>
                  ) : (
                    <p>
                      {c === "protein"
                        ? "たんぱく質は不足分をまとめて補わず、各日の通常目標を参考にしてください。"
                        : "記録の完全性と調整幅を確認し、残りは通常の設定目標を参考にしてください。"}
                    </p>
                  )}
                  {m.remaining_plan.map((p) => (
                    <p key={p.date}>
                      {p.date}：通常 {pfcAmount(p.usual_target)} {unit}
                      {p.reference !== null
                        ? ` · 条件付き参考 ${pfcAmount(p.reference)} ${unit}`
                        : ""}
                    </p>
                  ))}
                </details>
              </div>
            );
          })}
        </div>
        <p className="notice">
          未登録日は摂取ゼロにしません。食べ過ぎを理由に極端な制限を行ったり、たんぱく質・食物繊維の不足を一括摂取で埋め合わせたりする提案はしません。
        </p>
      </section>
      <section className="card">
        <h2>日別の摂取推移</h2>
        <div className="pfc-week-list">
          {days.map((d) => (
            <button
              type="button"
              className="button ghost"
              key={d.meal_date}
              aria-pressed={selected === d.meal_date}
              onClick={() => setSelected(d.meal_date)}
            >
              {d.meal_date.slice(5)}
              <span>{pfcAmount(d.metrics.energy.known_amount)} kcal</span>
              <small>{STATES[d.overall]}</small>
            </button>
          ))}
        </div>
        <PfcDayDetails day={day} />
      </section>
      <Link className="button ghost" href="/nutrition?view=details&range=7">
        7・30・90日の観察平均を見る →
      </Link>
      <p className="muted">
        集計タイムゾーン {period.time_zone} · {week.policy_version}
      </p>
    </div>
  );
}
