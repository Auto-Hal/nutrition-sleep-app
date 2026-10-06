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
    <section className="chatgpt-primary" aria-labelledby="chatgpt-nutrition-title">
      <div className="chatgpt-primary-copy">
        <span className="chatgpt-mark" aria-hidden="true">✦</span>
        <div>
          <strong id="chatgpt-nutrition-title">ChatGPTで食事を登録</strong>
          <small>料理名や店名を伝えるだけ</small>
        </div>
      </div>
      <a
        className="button chatgpt-primary-button"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        開く
      </a>
      {!configured && (
        <small className="chatgpt-config-warning">専用チャット未設定</small>
      )}
    </section>
  );
}
