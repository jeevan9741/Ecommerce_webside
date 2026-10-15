/**
 * Imported first by every test that writes to the database. The tests create and delete rows, and
 * backend/.env points at the production database — so they refuse to run unless DATABASE_URL is a
 * local server. To test against a separate cloud database (e.g. a Neon dev branch), set
 * ALLOW_REMOTE_TEST_DATABASE to that database's host name.
 */
import "dotenv/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

let host = "";
try {
  host = new URL(process.env.DATABASE_URL ?? "").hostname;
} catch {
  // handled below
}

if (!host) throw new Error("Tests need DATABASE_URL pointing at a local test database.");
if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_TEST_DATABASE !== host) {
  throw new Error(
    `Refusing to run database tests against ${host}: it isn't local and may be production. ` +
      "Point DATABASE_URL at a local test database, or set ALLOW_REMOTE_TEST_DATABASE to this host if it's a disposable one."
  );
}
