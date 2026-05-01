import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OAuthConsent from '../../client/src/pages/OAuthConsent';

// ---- Helpers ----

interface ConsentParams {
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  client_name?: string;
  client_description?: string;
}

function renderConsent(params: ConsentParams = {}) {
  const defaults: Required<ConsentParams> = {
    client_id: 'client-abc',
    redirect_uri: 'http://localhost:8080/callback',
    scope: 'profile users:read',
    state: 'random-state-123',
    code_challenge: 'challenge-abc',
    code_challenge_method: 'S256',
    client_name: 'My Test App',
    client_description: 'A test OAuth application',
    ...params,
  };
  const qs = new URLSearchParams(defaults as Record<string, string>).toString();
  return render(
    <MemoryRouter initialEntries={[`/oauth/consent?${qs}`]}>
      <OAuthConsent />
    </MemoryRouter>,
  );
}

function getHiddenInput(name: string): HTMLInputElement {
  return document.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement;
}

// ---- Tests ----

describe('OAuthConsent', () => {
  it('renders client name in heading', () => {
    renderConsent({ client_name: 'Awesome App' });
    expect(screen.getByRole('heading', { name: /Awesome App/i })).toBeInTheDocument();
  });

  it('renders client description', () => {
    renderConsent({ client_description: 'Does cool things' });
    expect(screen.getByText('Does cool things')).toBeInTheDocument();
  });

  it('renders scope chip with profile label', () => {
    renderConsent({ scope: 'profile' });
    expect(screen.getByText('Your basic profile (name, email, role)')).toBeInTheDocument();
  });

  it('renders scope chip with users:read label', () => {
    renderConsent({ scope: 'users:read' });
    expect(screen.getByText('Read directory of users')).toBeInTheDocument();
  });

  it('renders both scope chips when both scopes requested', () => {
    renderConsent({ scope: 'profile users:read' });
    expect(screen.getByText('Your basic profile (name, email, role)')).toBeInTheDocument();
    expect(screen.getByText('Read directory of users')).toBeInTheDocument();
  });

  it('renders unknown scope as raw scope string', () => {
    renderConsent({ scope: 'custom:scope' });
    expect(screen.getByText('custom:scope')).toBeInTheDocument();
  });

  it('has Allow button', () => {
    renderConsent();
    expect(screen.getByRole('button', { name: /allow/i })).toBeInTheDocument();
  });

  it('has Deny button', () => {
    renderConsent();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('form method is POST', () => {
    renderConsent();
    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    expect(form!.method.toLowerCase()).toBe('post');
  });

  it('form action is /oauth/authorize/consent', () => {
    renderConsent();
    const form = document.querySelector('form');
    expect(form!.getAttribute('action')).toBe('/oauth/authorize/consent');
  });

  it('Allow button has name=decision and value=allow', () => {
    renderConsent();
    const btn = screen.getByRole('button', { name: /allow/i }) as HTMLButtonElement;
    expect(btn.name).toBe('decision');
    expect(btn.value).toBe('allow');
  });

  it('Deny button has name=decision and value=deny', () => {
    renderConsent();
    const btn = screen.getByRole('button', { name: /deny/i }) as HTMLButtonElement;
    expect(btn.name).toBe('decision');
    expect(btn.value).toBe('deny');
  });

  it('includes client_id hidden field', () => {
    renderConsent({ client_id: 'my-client' });
    expect(getHiddenInput('client_id').value).toBe('my-client');
  });

  it('includes redirect_uri hidden field', () => {
    renderConsent({ redirect_uri: 'http://localhost:8080/cb' });
    expect(getHiddenInput('redirect_uri').value).toBe('http://localhost:8080/cb');
  });

  it('includes scopes hidden field (space-joined)', () => {
    renderConsent({ scope: 'profile users:read' });
    expect(getHiddenInput('scopes').value).toBe('profile users:read');
  });

  it('includes state hidden field', () => {
    renderConsent({ state: 'xyz-state' });
    expect(getHiddenInput('state').value).toBe('xyz-state');
  });

  it('includes code_challenge hidden field', () => {
    renderConsent({ code_challenge: 'abc123challenge' });
    expect(getHiddenInput('code_challenge').value).toBe('abc123challenge');
  });

  it('includes code_challenge_method hidden field', () => {
    renderConsent({ code_challenge_method: 'S256' });
    expect(getHiddenInput('code_challenge_method').value).toBe('S256');
  });
});
