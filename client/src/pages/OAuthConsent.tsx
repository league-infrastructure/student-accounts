import { useSearchParams } from 'react-router-dom';
import { scopeLabel } from '../lib/oauth-scopes';

/**
 * OAuthConsent — the user-facing consent screen for the authorization-code flow.
 *
 * Reached from GET /oauth/authorize (ticket 005) when the user is authenticated
 * but has not yet granted consent for the requesting client + scope combination.
 *
 * The page reads all OAuth parameters from the query string (round-tripped from
 * the authorize endpoint — no additional API call needed). It renders a real
 * HTML form that POSTs to /oauth/authorize/consent; the server issues a 302
 * redirect back to the client app after processing the decision. Using a real
 * form POST (not fetch) is required so the browser follows the 302 natively.
 */
export default function OAuthConsent() {
  const [searchParams] = useSearchParams();

  const clientId = searchParams.get('client_id') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '';
  const scopeStr = searchParams.get('scope') ?? '';
  const state = searchParams.get('state') ?? '';
  const codeChallenge = searchParams.get('code_challenge') ?? '';
  const codeChallengeMethod = searchParams.get('code_challenge_method') ?? 'S256';
  const clientName = searchParams.get('client_name') ?? clientId;
  const clientDescription = searchParams.get('client_description') ?? '';

  const scopes = scopeStr ? scopeStr.split(' ').filter(Boolean) : [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-md p-8">
        {/* Header */}
        <h1 className="text-xl font-semibold text-slate-800 mb-2">
          {clientName} wants to access your account
        </h1>
        {clientDescription && (
          <p className="text-sm text-slate-500 mb-6">{clientDescription}</p>
        )}

        {/* Requested scopes */}
        {scopes.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-700 mb-2">
              This app is requesting:
            </p>
            <ul className="flex flex-col gap-2">
              {scopes.map((scope) => (
                <li
                  key={scope}
                  className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-800 rounded-full px-3 py-1 text-sm font-medium"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  {scopeLabel(scope)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          Real HTML form POST — NOT fetch. The server responds with a 302
          redirect to redirect_uri?code=...&state=... and the browser must
          follow that redirect natively so the third-party app receives it.
          A fetch call would capture the redirect response inside the SPA.
        */}
        <form method="POST" action="/oauth/authorize/consent">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="scopes" value={scopes.join(' ')} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />

          <div className="flex gap-3 mt-2">
            <button
              type="submit"
              name="decision"
              value="allow"
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Allow
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
            >
              Deny
            </button>
          </div>
        </form>

        <p className="text-xs text-slate-400 mt-4 text-center">
          You can revoke access at any time from your account settings.
        </p>
      </div>
    </div>
  );
}
