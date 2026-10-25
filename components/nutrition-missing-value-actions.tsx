import Link from "next/link";

export function NutritionMissingValueActions({ entryId }: { entryId: string }) {
  return (
    <div className="nutrition-meta">
      <p>食品の栄養値を直しても、過去の食事記録は自動更新されません。出典を確認して食品を直した後、必要な食事記録も明示的に修正してください。</p>
      <p><Link className="text-link" href="/settings?view=library#catalog-list-title">食品の栄養値を確認・編集</Link></p>
      <p><Link className="text-link" href={`/history/edit?entry=${encodeURIComponent(entryId)}`}>この食事記録を修正</Link></p>
    </div>
  );
}
