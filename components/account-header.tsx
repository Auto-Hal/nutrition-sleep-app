import { AppIcon } from "@/components/app-icon";

export function AccountHeader({ email, onLogout }: { email?: string; onLogout: () => void }) {
  return (
    <header className="account-header">
      <span className="app-wordmark"><span className="wordmark-symbol" aria-hidden="true" /><span>栄養と睡眠<small>NUTRITION & SLEEP</small></span></span>
      <details className="account-menu">
        <summary aria-label="アカウントメニュー"><AppIcon name="account" /></summary>
        <div className="account-menu-panel">
          <span className="muted">{email ?? "アカウント"}</span>
          <button className="button secondary" type="button" onClick={onLogout}>ログアウト</button>
        </div>
      </details>
    </header>
  );
}
