/**
 * Predicates for classifying user emails by League domain.
 *
 * Student accounts live under `@students.jointheleague.org`.
 * Staff / admin accounts live under any other `*.jointheleague.org`
 * subdomain (including the bare `@jointheleague.org`).
 */

export function isStudentLeagueEmail(email: string): boolean {
  return /@students\.jointheleague\.org$/i.test(email);
}

export function isStaffLeagueEmail(email: string): boolean {
  return (
    /@([a-z0-9-]+\.)?jointheleague\.org$/i.test(email) &&
    !isStudentLeagueEmail(email)
  );
}
