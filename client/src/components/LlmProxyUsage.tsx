/**
 * LlmProxyUsage — compatibility wrapper around LlmProxySetupExamples
 * (sprint 003, ticket 004). The admin UserLlmProxyCard still imports this
 * name; ticket 005 moves it to the shared component directly, after which
 * this file can go.
 */

import LlmProxySetupExamples from './LlmProxySetupExamples';

export default function LlmProxyUsage({
  endpoint,
  token,
}: {
  endpoint: string;
  token: string;
}) {
  return <LlmProxySetupExamples endpoint={endpoint} token={token} />;
}
