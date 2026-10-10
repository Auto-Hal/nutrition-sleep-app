type Page<T> = { data: T[] | null; error: { message: string } | null; count: number | null };

// Query factories must request an exact count and use a unique, stable order.
export async function readAllPages<T>(query: (from: number, to: number) => PromiseLike<Page<T>>) {
  const rows: T[] = [];
  let expected: number | null = null;
  do {
    const page = await query(rows.length, rows.length + 499);
    if (page.error) throw new Error(page.error.message);
    if (page.count === null) throw new Error("取得件数を確認できませんでした。");
    if (expected !== null && expected !== page.count) throw new Error("取得中に記録が変更されました。再取得してください。");
    expected = page.count;
    const received = page.data ?? [];
    if (received.length === 0 && rows.length < expected) throw new Error("記録をすべて取得できませんでした。");
    rows.push(...received);
    if (rows.length > expected) throw new Error("取得件数が一致しません。");
  } while (rows.length < (expected ?? 0));
  return rows;
}
