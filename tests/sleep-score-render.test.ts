import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RawSleepSession, SleepRange } from "@/lib/sleep/analytics";
import { buildSleepAssessment, shiftSleepDate, type SleepAssessment } from "@/lib/sleep/assessment";
import { sleepRecommendations } from "@/lib/sleep/recommendations";
import { SleepScore, SleepScoreBreakdown } from "@/components/sleep-score";
import { SleepTrends } from "@/components/sleep-trends";
import { SleepAdvice } from "@/components/sleep-advice";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => {
  if (process.env.WRITE_SLEEP_UI_PREVIEW === "1") writeSyntheticPreview();
  vi.unstubAllGlobals();
});

const END = "2026-10-26";
function session(date: string, changes: Partial<RawSleepSession> = {}, wake = 420): RawSleepSession {
  const end = Date.parse(`${date}T00:00:00Z`) + (wake - 540) * 60000;
  return {
    id: `synthetic-${date}`, sleep_date: date,
    start_at: new Date(end - 500 * 60000).toISOString(), end_at: new Date(end).toISOString(),
    start_utc_offset_seconds: 32400, end_utc_offset_seconds: 32400,
    sleep_type: "stages", provider_nap: false, provider_processed: true,
    minutes_asleep: 450, time_in_bed_minutes: 480, efficiency: null,
    minutes_to_fall_asleep: null, minutes_after_wakeup: null, minutes_awake: null,
    superseded_at: null, ...changes,
  };
}

function history(count = 200) {
  return Array.from({ length: count }, (_, index) => session(shiftSleepDate(END, index - count + 1), {
    minutes_asleep: 390 + index % 5 * 15,
  }, 420 + index % 3 * 5));
}

function assess(sessions: RawSleepSession[], range: SleepRange = 7, endDate = END) {
  return buildSleepAssessment({ sessions, timeZone: "Asia/Tokyo", range, endDate, birthDate: "1990-01-01" });
}

function markup(element: React.ReactNode) {
  return renderToStaticMarkup(element);
}

function text(element: React.ReactNode) {
  return markup(element).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function recommendations(assessment: SleepAssessment) {
  return sleepRecommendations(assessment.current, { range: assessment.range, endDate: assessment.end_date, connectionStatus: "connected" });
}

function fixtureElements(assessment: SleepAssessment) {
  return React.createElement("div", { className: "sleep-stack" },
    React.createElement(SleepScore, { assessment }),
    React.createElement(SleepAdvice, { recommendations: recommendations(assessment) }),
    React.createElement(SleepTrends, { assessment }),
    React.createElement(SleepScoreBreakdown, { night: assessment.latest }),
  );
}

function writeSyntheticPreview() {
  const css = ["app/globals.css", "app/visual-theme.css", "app/ui-refresh.css", "app/sleep-score.css"]
    .map((path) => readFileSync(resolve(path), "utf8")).join("\n");
  const output = resolve("test-results");
  mkdirSync(output, { recursive: true });
  function write(name: string, content: string, nav = "") {
    writeFileSync(resolve(output, name), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>睡眠スコア・人工データ検証</title><style>${css}</style></head><body><main class="app-main sleep-page"><header class="topbar sleep-topbar"><div><p class="eyebrow">全て架空の記録</p><h1>睡眠スコア</h1></div></header><p class="page-purpose">本番データを使わない表示検証です。同期操作や実アプリへのリンク先はこの静的プレビューに含みません。</p>${nav}${content}</main></body></html>`, "utf8");
  }
  const cases = [
    { id: "normal", title: "通常スコア", assessment: assess(history()) },
    { id: "provisional", title: "暫定スコア", assessment: assess([session(END, { time_in_bed_minutes: null })]) },
    { id: "held", title: "算出保留", assessment: assess([session(END, { minutes_asleep: null })]) },
    { id: "processing", title: "提供元で処理中", assessment: assess([session(END, { provider_processed: false })]) },
    { id: "unobserved", title: "まだ未観測", assessment: assess([]) },
  ];
  write("sleep-score-preview.html", cases.map((item) => `<section class="stack" style="margin:24px 0" data-preview-case="${item.id}"><h2>架空例：${item.title}</h2>${markup(fixtureElements(item.assessment))}</section>`).join("\n")
    + `<section data-preview-case="today" class="stack" style="margin:24px 0"><h2>Todayの表示</h2>${markup(React.createElement(SleepScore, { assessment: cases[0].assessment, compact: true }))}</section>`);

  const seeded = history().filter((row) => row.sleep_date !== shiftSleepDate(END, -3)).map((row) => {
    if (row.sleep_date === shiftSleepDate(END, -4)) return { ...row, provider_processed: false };
    if (row.sleep_date === shiftSleepDate(END, -5)) return { ...row, time_in_bed_minutes: null };
    return row;
  });
  for (const range of [7, 30, 90] as const) {
    const assessment = assess(seeded, range);
    const nav = `<nav class="subnav" aria-label="睡眠集計期間">${[7, 30, 90].map((value) => `<a href="/sleep-score-preview-${value}.html"${value === range ? ' aria-current="page"' : ""}>${value}日</a>`).join("")}</nav>`;
    write(`sleep-score-preview-${range}.html`, markup(fixtureElements(assessment))
      + `<section data-preview-case="today" class="stack" style="margin:24px 0"><h2>Todayの表示</h2>${markup(React.createElement(SleepScore, { assessment, compact: true }))}</section>`, nav);
  }
}

describe("rendered Sleep Score v1 from canonical synthetic sessions", () => {
  it("renders a normal score, measured duration, version and non-diagnostic explanation", () => {
    const assessment = assess(Array.from({ length: 10 }, (_, index) => session(shiftSleepDate(END, index - 9))));
    const html = markup(React.createElement(SleepScore, { assessment }));
    const content = text(React.createElement(SleepScore, { assessment }));
    expect(html).toContain('data-score-state="normal"');
    expect(content).toContain("100 / 100点");
    expect(content).toContain("7時間 30分");
    expect(content).toContain("Sleep Score v1");
    expect(content).toContain("診断する点数ではありません");
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows the available subtotal and score range without renormalizing a provisional score", () => {
    const assessment = assess([session(END, { time_in_bed_minutes: null })]);
    const content = text(React.createElement(SleepScore, { assessment }));
    expect(content).toContain("暫定スコア");
    expect(content).toContain("50 / 50点");
    expect(content).toContain("カバー率 50%");
    expect(content).toContain("総合の範囲 50〜100 / 100点");
    expect(content).toContain("通常スコアの平均には含めません");
    expect(markup(React.createElement(SleepScore, { assessment }))).not.toContain("sleep-score-gauge");
  });

  it.each([
    ["held", { minutes_asleep: null }, "主な睡眠時間が未取得"],
    ["processing", { provider_processed: false }, "提供元で処理中"],
    ["held", { provider_nap: true }, "昼寝のみの記録"],
  ] as const)("keeps %s separate from a zero score", (state, changes, explanation) => {
    const assessment = assess([session(END, changes)]);
    const html = markup(React.createElement(SleepScore, { assessment }));
    expect(html).toContain(`data-score-state="${state}"`);
    expect(text(React.createElement(SleepScore, { assessment }))).toContain(explanation);
    expect(html).not.toContain("sleep-score-gauge");
  });

  it("labels an empty period as unobserved and an older latest night without suggesting deterioration", () => {
    expect(markup(React.createElement(SleepScore, { assessment: assess([]) }))).toContain('data-score-state="unobserved"');
    const old = assess([session(shiftSleepDate(END, -1))]);
    expect(text(React.createElement(SleepScore, { assessment: old }))).toContain(`${END}の記録はまだありません`);
    expect(text(React.createElement(SleepScore, { assessment: old }))).toContain("睡眠の悪化として扱いません");
  });

  it("renders actual component points, missing reasons, separate public guidance and sources", () => {
    const assessment = assess([session(END, { time_in_bed_minutes: null, minutes_asleep: 360 })]);
    const content = text(React.createElement(SleepScoreBreakdown, { night: assessment.latest }));
    expect(content).toContain("32.5 / 50点");
    expect(content).toContain("規則性の基準となる過去の記録が3夜未満");
    expect(content).toContain("提供元の睡眠区間が未取得");
    expect(content).toContain("6時間以上");
    expect(content).toContain("18〜60歳");
    expect(content).toContain("ステージと昼寝は得点に加えません");
    expect(content).not.toContain("missing_time_in_bed");
    expect(markup(React.createElement(SleepScoreBreakdown, { night: assessment.latest }))).toContain("PMC5940440");
  });

  it.each([7, 30, 90] as const)("renders %i-day normal-only averages, all states, accessible charts and daily links", (range) => {
    const sessions = history().filter((row) => row.sleep_date !== shiftSleepDate(END, -1)).map((row) => row.sleep_date === END ? { ...row, time_in_bed_minutes: null } : row);
    const assessment = assess(sessions, range);
    const html = markup(React.createElement(SleepTrends, { assessment }));
    const content = text(React.createElement(SleepTrends, { assessment }));
    expect(content).toContain(`${range}日間の睡眠傾向`);
    expect(content).toContain(`通常${assessment.summary.normal_days}夜のみ`);
    expect(content).toContain("暫定1夜");
    expect(content).toContain("未観測1夜");
    expect(html).toContain('role="img"');
    expect(html).toContain(`range=${range}&amp;day=${END}#night-detail`);
    expect(content).toContain("起床時刻のばらつき");
    expect(content).toContain("就寝時刻のばらつき");
    expect(content).toContain("日付跨ぎは最短の差");
  });

  it("keeps unobserved nights out of the line instead of drawing them as zeros", () => {
    const sessions = history().filter((row) => row.sleep_date !== shiftSleepDate(END, -2));
    const assessment = assess(sessions);
    const html = markup(React.createElement(SleepTrends, { assessment }));
    const scoreFigure = html.slice(html.indexOf("<figure"), html.indexOf("</figure>") + 9);
    expect(scoreFigure.match(/<polyline/g)).toHaveLength(2);
    expect(scoreFigure.match(/<circle/g)).toHaveLength(6);
  });

  it("explains an unavailable comparison rather than describing it as a score decline", () => {
    const content = text(React.createElement(SleepTrends, { assessment: assess([session(END)]) }));
    expect(content).toContain("比較保留");
    expect(content).not.toContain("平均スコアが低く");
  });

  it("plots midnight-adjacent wake times 20 minutes apart rather than nearly 24 hours apart", () => {
    const sessions = Array.from({ length: 7 }, (_, index) => session(shiftSleepDate(END, index - 6), {}, index === 6 ? 10 : 1430));
    const html = markup(React.createElement(SleepTrends, { assessment: assess(sessions) }));
    const index = html.indexOf("<figcaption>起床時刻のばらつき");
    const clockFigure = html.slice(index, html.indexOf("</figure>", index));
    expect(clockFigure).toContain("2026-10-25：−20分");
    expect(clockFigure).toContain("2026-10-26：0分");
    expect(clockFigure).not.toContain("1420分");
  });

  it("breaks a clock trend across a provider time offset change", () => {
    const sessions = history(7).map((row, index) => index < 3 ? row : { ...row, start_utc_offset_seconds: 28800, end_utc_offset_seconds: 28800 });
    const html = markup(React.createElement(SleepTrends, { assessment: assess(sessions) }));
    const index = html.indexOf("<figcaption>起床時刻のばらつき");
    const clockFigure = html.slice(index, html.indexOf("</figure>", index));
    expect(clockFigure.match(/<polyline/g)).toHaveLength(2);
  });

  it("shows one primary action, secondary evidence in details and symptom consultation without diagnoses", () => {
    const assessment = assess(history().map((row) => ({ ...row, minutes_asleep: 330 })));
    const items = recommendations(assessment);
    const html = markup(React.createElement(SleepAdvice, { recommendations: items }));
    const content = text(React.createElement(SleepAdvice, { recommendations: items }));
    expect(html.match(/class="guide-next"/g)).toHaveLength(1);
    expect(content).toContain(items[0].action);
    expect(content).toContain(items[0].evidence);
    expect(content).toContain(items[0].expected_direction);
    expect(content).toContain("医療機関や適切な専門家に相談");
    expect(content).toContain("診断しません");
  });

  it("keeps Today compact and links to score detail", () => {
    const html = markup(React.createElement(SleepScore, { assessment: assess(history()), compact: true }));
    expect(html).toContain("sleep-score-compact");
    expect(html).toContain('href="/sleep#sleep-score"');
    expect(html).not.toContain("sleep-score-components");
  });
});
