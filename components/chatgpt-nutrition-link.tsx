const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";

function configuredChatGptUrl() {
  const configured = process.env.NEXT_PUBLIC_CHATGPT_NUTRITION_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "chatgpt.com" && url.hostname !== "www.chatgpt.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function ChatGptNutritionLink() {
  const configured = configuredChatGptUrl();
  const href = configured ?? DEFAULT_CHATGPT_URL;

  return (
    <section className="notice" aria-labelledby="chatgpt-nutrition-title">
      <strong id="chatgpt-nutrition-title">外食・食材はChatGPTで調べられます。</strong>
      <p>
        店名・料理名・食材の量を自然な文章で伝えてください。Phase 7では、計算結果をこのアプリへ下書きとして直接返す導線を追加します。
      </p>
      <div className="form-actions">
        <a
          className="button secondary"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          ChatGPTで食事を調べる
        </a>
      </div>
      {!configured && (
        <small className="muted">
          専用チャットURLは未設定です。現在はChatGPTのトップを開きます。
        </small>
      )}
    </section>
  );
}
