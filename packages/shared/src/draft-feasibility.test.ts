import test from "node:test";
import assert from "node:assert/strict";
import { buildRolePoolMap, evaluateDraftFeasibility } from "./draft-feasibility";

test("feasible draft with flex hero should pass", () => {
  const pool = buildRolePoolMap([
    { mlid: 1, lanes: ["exp"] },
    { mlid: 2, lanes: ["jungle"] },
    { mlid: 3, lanes: ["mid"] },
    { mlid: 4, lanes: ["gold", "mid"] },
    { mlid: 5, lanes: ["roam", "exp"] }
  ]);

  const result = evaluateDraftFeasibility([1, 2, 3, 4, 5], pool);
  assert.equal(result.isFeasible, true);
  assert.equal(result.matchedCount, 5);
  assert.deepEqual(result.unassignedHeroes, []);
});

test("infeasible draft with overlapping role options should fail", () => {
  const pool = buildRolePoolMap([
    { mlid: 10, lanes: ["exp"] },
    { mlid: 11, lanes: ["exp"] },
    { mlid: 12, lanes: ["exp"] }
  ]);

  const result = evaluateDraftFeasibility([10, 11, 12], pool);
  assert.equal(result.isFeasible, false);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.unassignedHeroes.length, 2);
});

test("flex assignment should maximize matched heroes", () => {
  const pool = buildRolePoolMap([
    { mlid: 21, lanes: ["mid", "gold"] },
    { mlid: 22, lanes: ["gold"] },
    { mlid: 23, lanes: ["mid", "jungle"] }
  ]);

  const result = evaluateDraftFeasibility([21, 22, 23], pool);
  assert.equal(result.isFeasible, true);
  assert.equal(result.matchedCount, 3);
  assert.equal(Object.keys(result.heroToLane).length, 3);
});
