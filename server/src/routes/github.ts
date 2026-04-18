import { Router, Request, Response } from 'express';

export const githubRouter = Router();

// GET /api/github/repos — list the authenticated user's GitHub repositories
// Requires the user to be logged in via GitHub OAuth (access token in session).
// Docs: https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user
githubRouter.get('/github/repos', async (req: Request, res: Response) => {
  // Check if GitHub OAuth is configured at all
  if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
    return res.status(501).json({
      error: 'GitHub OAuth not configured',
      docs: 'https://github.com/settings/developers',
    });
  }

  // Check if user is authenticated via GitHub
  const user = req.user as any;
  const githubToken = (req.session as any).githubAccessToken;
  if (!user || user.provider !== 'github' || !githubToken) {
    return res.status(401).json({
      error: 'Not authenticated via GitHub',
      detail: 'Log in with GitHub first at /api/auth/github',
    });
  }

  try {
    const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'docker-nodeapp',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'GitHub API error',
        detail: `${response.status} ${response.statusText}`,
      });
    }

    const repos = await response.json();
    const simplified = (repos as any[]).map((repo) => ({
      name: repo.name,
      description: repo.description,
      url: repo.html_url,
      stars: repo.stargazers_count,
      language: repo.language,
    }));

    res.json(simplified);
  } catch (err: any) {
    res.status(502).json({
      error: 'Failed to reach GitHub API',
      detail: err.message,
    });
  }
});
