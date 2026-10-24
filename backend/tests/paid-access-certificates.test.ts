/**
 * PAID_ACCESS on the course-certificate endpoints. Belongs with the certificate feature (commit it
 * together with certificate.controller/service). Fixture: paid-access.fixture.ts.
 */
import { accessMatrix, call, courseId, useFixture, type Surface } from "./paid-access.fixture.js";

useFixture();

const SURFACES: Surface[] = [
  ["certificate panel (GET /me/courses/:id/certificate)", async (t) => (await call("GET", `/me/courses/${courseId}/certificate`, t)).status === 200],
  ["certificate progress list (GET /me/certificates)", async (t) =>
    (await call("GET", "/me/certificates", t)).body.courses.some((c: { courseId: string }) => c.courseId === courseId)],
];

accessMatrix("only a PAID order with live access unlocks certificates", SURFACES);
