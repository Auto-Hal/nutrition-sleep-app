import type { Route } from "next";
import { redirect } from "next/navigation";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getOAuthAuthorizationDetails, safeOAuthNextPath } from "@/lib/auth/oauth-server";

export const dynamic = "force-dynamic";

type ConsentPageProps = {
  searchParams: Promise<{ authorization_id?: string }>;
};

const scopeLabels: Record<string, string> = {
  openid: "アカウント識別",
  email: "メールアドレスの確認",
  profile: "基本プロフィールの確認",
};

function trustedOAuthRedirect(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("OAuthの戻り先がHTTPSではありません。");
  return url.toString();
}

export default async function OAuthConsentPage({ searchParams }: ConsentPageProps) {
  const authorizationId = (await searchParams).authorization_id;
  if (!authorizationId || authorizationId.length > 512) {
    return (
      <main className="auth-page">
        <section className="card auth-card stack">
          <h1>連携リクエストを確認できません</h1>
          <p className="muted">authorization_id がありません。ChatGPTのプラグイン接続からやり直してください。</p>
        </section>
      </main>
    );
  }

  const session = await getAppSessionForRsc();
  if (!session) {
    const next = safeOAuthNextPath(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    redirect(`/login?next=${encodeURIComponent(next ?? "/oauth/consent")}` as Route);
  }

  let details;
  try {
    details = await getOAuthAuthorizationDetails(session.accessToken, authorizationId);
  } catch (error) {
    return (
      <main className="auth-page">
        <section className="card auth-card stack">
          <h1>ChatGPT連携を確認できません</h1>
          <p className="error-text">{error instanceof Error ? error.message : "認可リクエストを取得できませんでした。"}</p>
        </section>
      </main>
    );
  }

  if ("redirect_url" in details) {
    redirect(trustedOAuthRedirect(details.redirect_url) as Route);
  }

  const scopes = (details.scope ?? "").split(/\s+/u).filter(Boolean);
  return (
    <main className="auth-page">
      <section className="card auth-card stack" aria-labelledby="oauth-consent-title">
        <div>
          <p className="eyebrow">ChatGPT Connection</p>
          <h1 id="oauth-consent-title">栄養アプリとの連携を許可しますか？</h1>
          <p className="muted">
            {details.client?.name ?? "ChatGPT"} が、あなたの栄養アプリアカウントとして専用ツールを利用しようとしています。
          </p>
        </div>

        <div className="notice">
          <strong>この連携で許可する操作</strong>
          <p>ChatGPTは食事の「下書き」を作成できます。既存の食事記録を確定・修正・削除する権限は与えません。</p>
        </div>

        {scopes.length > 0 && (
          <div>
            <strong>認証に使用する情報</strong>
            <ul>
              {scopes.map((scope) => <li key={scope}>{scopeLabels[scope] ?? scope}</li>)}
            </ul>
          </div>
        )}

        <form className="form-actions" action="/api/oauth/decision" method="post">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button className="button secondary" type="submit" name="decision" value="deny">許可しない</button>
          <button className="button" type="submit" name="decision" value="approve">連携を許可</button>
        </form>
      </section>
    </main>
  );
}
