/* Pure configuration only: no pg import, certificate reads, DNS or connections.
 * pg parses connectionString AFTER ssl options, so normalize its TLS parameters
 * too. A bare rejectUnauthorized:true can otherwise be silently overridden. */
export function postgresPoolOptions(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || /\s/.test(url.hostname)) throw new Error('DATABASE_URL requires a PostgreSQL host and database');
  // Query host overrides obscure the destination, including sslmode=disable.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) throw new Error('DATABASE_URL host overrides are not supported');
  for (const name of ['sslmode', 'ssl', 'uselibpqcompat']) {
    if (url.searchParams.getAll(name).length > 1) throw new Error('DATABASE_URL has duplicate TLS parameters');
  }
  const mode = url.searchParams.get('sslmode');
  if (mode !== null && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(mode)) throw new Error('DATABASE_URL has an unsupported TLS mode');
  const ssl = url.searchParams.get('ssl');
  if (ssl !== null && !['true', '1'].includes(ssl)) throw new Error('DATABASE_URL cannot disable TLS through ssl');
  if (url.searchParams.has('uselibpqcompat') && url.searchParams.get('uselibpqcompat') !== 'false') throw new Error('DATABASE_URL cannot weaken TLS through libpq compatibility');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (mode === 'disable' && !local) throw new Error('DATABASE_URL sslmode=disable is restricted to explicit loopback hosts');
  url.searchParams.delete('ssl');
  url.searchParams.delete('uselibpqcompat');
  // Keep custom CA/client-cert references, but always require hostname verification.
  url.searchParams.set('sslmode', mode === 'disable' ? 'disable' : 'verify-full');
  return { connectionString: url.href, ssl: mode === 'disable' ? false : { rejectUnauthorized: true } };
}
