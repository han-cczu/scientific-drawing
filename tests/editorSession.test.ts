import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBlankScene } from "../src/editor/sceneOps";
import { createEditorSession } from "../src/editor/model/session";
import { createSceneTaskRunner } from "../src/editor/model/taskRunner";
import { primarySelectedNode } from "../src/editor/model/selection";

function setup() {
  return createEditorSession({
    ...createBlankScene(),
    nodes: ["a", "b"].map((id) => ({
      id,
      type: "rect" as const,
      x: 10,
      y: 20,
      w: 50,
      h: 40,
      style: {},
    })),
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("editor session transactions", () => {
  it("moves adjacent selections as a stable group independent of click order and undoes the whole operation", () => {
    for (const ids of [
      ["a", "b"],
      ["b", "a"],
    ]) {
      const session = setup();
      session.dispatch({
        type: "edit",
        command: {
          type: "add",
          nodes: [
            { id: "c", type: "rect", x: 0, y: 0, w: 10, h: 10, style: {} },
          ],
        },
      });
      const before = session.getSnapshot().history;
      session.dispatch({
        type: "edit",
        command: { type: "layer", ids, direction: "forward" },
      });
      assert.deepEqual(
        session.getSnapshot().history.present.nodes.map((node) => node.id),
        ["c", "a", "b"],
      );
      assert.equal(
        session.getSnapshot().history.past.length,
        before.past.length + 1,
      );
      session.dispatch({ type: "undo" });
      assert.deepEqual(session.getSnapshot().history.present, before.present);
      session.dispatch({ type: "redo" });
      assert.deepEqual(
        session.getSnapshot().history.present.nodes.map((node) => node.id),
        ["c", "a", "b"],
      );
    }
  });
  it("preserves selected order at layer boundaries and leaves the source-image prefix fixed", () => {
    const base = {
      ...createBlankScene(),
      nodes: [
        {
          id: "source",
          type: "image" as const,
          source: "/uploads/source.png",
          locked: true,
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          style: {},
        },
        ...["a", "b", "c", "d"].map((id) => ({
          id,
          type: "rect" as const,
          x: 10,
          y: 20,
          w: 50,
          h: 40,
          style: {},
        })),
      ],
    };
    const cases = [
      {
        ids: ["b", "a"],
        direction: "backward" as const,
        expected: ["source", "a", "b", "c", "d"],
      },
      {
        ids: ["d", "c"],
        direction: "forward" as const,
        expected: ["source", "a", "b", "c", "d"],
      },
      {
        ids: ["c", "a"],
        direction: "front" as const,
        expected: ["source", "b", "d", "a", "c"],
      },
      {
        ids: ["d", "b", "source"],
        direction: "back" as const,
        expected: ["source", "b", "d", "a", "c"],
      },
      {
        ids: ["c", "b"],
        direction: "backward" as const,
        expected: ["source", "b", "c", "a", "d"],
      },
    ];
    for (const { ids, direction, expected } of cases) {
      const session = createEditorSession(base);
      session.dispatch({
        type: "edit",
        command: { type: "layer", ids, direction },
      });
      assert.deepEqual(
        session.getSnapshot().history.present.nodes.map((node) => node.id),
        expected,
      );
      if (expected.join() === base.nodes.map((node) => node.id).join())
        assert.equal(session.getSnapshot().history.past.length, 0);
    }
  });
  it("uses the same primary node for inspector display and edits after reverse-order multi-selection", () => {
    const session = setup();
    session.dispatch({ type: "select", ids: ["b", "a"] });
    const state = session.getSnapshot();
    const displayed = primarySelectedNode(
      state.history.present,
      state.selectedIds,
    );
    assert.equal(displayed?.id, "b");
    session.dispatch({
      type: "edit",
      command: { type: "node", id: displayed!.id, patch: { x: 77 } },
    });
    assert.equal(
      session
        .getSnapshot()
        .history.present.nodes.find((node) => node.id === "b")?.x,
      77,
    );
    assert.equal(
      session
        .getSnapshot()
        .history.present.nodes.find((node) => node.id === "a")?.x,
      10,
    );
    session.dispatch({ type: "undo" });
    assert.equal(
      primarySelectedNode(
        session.getSnapshot().history.present,
        session.getSnapshot().selectedIds,
      )?.x,
      10,
    );
  });
  it("locks a selection in one undo entry and restores the entire batch", () => {
    const session = setup();
    session.dispatch({
      type: "edit",
      command: { type: "lock", ids: ["a", "b"], locked: true },
    });
    assert.equal(session.getSnapshot().history.past.length, 1);
    session.dispatch({ type: "undo" });
    assert.ok(
      session.getSnapshot().history.present.nodes.every((n) => !n.locked),
    );
    session.dispatch({ type: "redo" });
    assert.ok(
      session.getSnapshot().history.present.nodes.every((n) => n.locked),
    );
  });
  it("commits a drag once; ignores no-op changes and rolls back interrupted previews", () => {
    const s = setup();
    const move = (dx: number) =>
      s.dispatch({
        type: "edit",
        preview: true,
        command: { type: "move", ids: ["a"], dx, dy: 0 },
      });
    move(5);
    move(7);
    assert.equal(s.getSnapshot().history.past.length, 0);
    s.dispatch({ type: "commitInteraction" });
    assert.equal(s.getSnapshot().history.past.length, 1);
    s.dispatch({ type: "undo" });
    assert.equal(s.getSnapshot().history.present.nodes[0].x, 10);
    move(0);
    assert.equal(s.getSnapshot().interactionBaseline, null);
    move(8);
    s.dispatch({ type: "cancelInteraction" });
    assert.equal(s.getSnapshot().history.present.nodes[0].x, 10);
    assert.equal(s.getSnapshot().history.past.length, 0);
  });
  it("rejects stale drag previews after undo and redo while allowing a newly started gesture", () => {
    const session = setup();
    const firstEpoch = session.getSnapshot().interactionEpoch;
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: firstEpoch,
      command: { type: "move", ids: ["a"], dx: 10, dy: 0 },
    });
    assert.equal(session.getSnapshot().interactionEpoch, firstEpoch);
    session.dispatch({ type: "undo" });
    const undone = session.getSnapshot();
    assert.equal(undone.history.present.nodes[0].x, 10);
    assert.equal(undone.history.future.length, 1);
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: firstEpoch,
      command: { type: "move", ids: ["a"], dx: 7, dy: 0 },
    });
    assert.equal(session.getSnapshot(), undone);
    session.dispatch({ type: "redo" });
    const redone = session.getSnapshot();
    assert.equal(redone.history.present.nodes[0].x, 20);
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: undone.interactionEpoch,
      command: { type: "move", ids: ["a"], dx: 7, dy: 0 },
    });
    assert.equal(session.getSnapshot(), redone);
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: redone.interactionEpoch,
      command: { type: "move", ids: ["a"], dx: 5, dy: 0 },
    });
    session.dispatch({ type: "commitInteraction" });
    assert.equal(session.getSnapshot().history.present.nodes[0].x, 25);
    assert.equal(session.getSnapshot().history.past.length, 2);
  });
  it("rejects the captured resize start box after history navigation and preserves redo geometry", () => {
    const session = setup();
    const epoch = session.getSnapshot().interactionEpoch;
    const box = { x: 10, y: 20, w: 50, h: 40 };
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: epoch,
      command: { type: "resize", id: "a", handle: "se", box, dx: 20, dy: 10 },
    });
    session.dispatch({ type: "undo" });
    const undone = session.getSnapshot();
    assert.equal(undone.history.present.nodes[0].w, 50);
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: epoch,
      command: { type: "resize", id: "a", handle: "se", box, dx: 30, dy: 20 },
    });
    assert.equal(session.getSnapshot(), undone);
    session.dispatch({ type: "redo" });
    const redone = session.getSnapshot();
    assert.equal(redone.history.present.nodes[0].w, 70);
    assert.equal(redone.history.present.nodes[0].h, 50);
    session.dispatch({
      type: "edit",
      preview: true,
      interactionEpoch: epoch,
      command: { type: "resize", id: "a", handle: "se", box, dx: 40, dy: 30 },
    });
    assert.equal(session.getSnapshot(), redone);
  });
  it("blocks every edit and undo during a task, while viewport changes remain available", () => {
    const s = setup();
    const before = s.getSnapshot().history;
    const token = s.beginTask("region")!;
    s.dispatch({ type: "edit", command: { type: "delete", ids: ["a"] } });
    s.dispatch({
      type: "edit",
      command: { type: "lock", ids: ["b"], locked: true },
    });
    s.dispatch({ type: "undo" });
    s.dispatch({
      type: "viewport",
      viewport: { scale: 2, offset: { x: 3, y: 4 } },
    });
    assert.equal(s.getSnapshot().history, before);
    assert.equal(s.getSnapshot().viewport.scale, 2);
    assert.equal(s.beginTask("import"), null);
    const changed = { ...before.present, nodes: [] };
    s.dispatch({
      type: "taskResult",
      token: { ...token, revision: token.revision + 1 },
      scene: changed,
      replace: false,
    });
    assert.equal(s.getSnapshot().history, before);
    s.dispatch({ type: "taskResult", token, scene: changed, replace: false });
    assert.equal(s.getSnapshot().history.past.length, 1);
  });
  it("ignores success and errors from cancelled requests even after a newer task starts", async () => {
    const s = setup();
    const runner = createSceneTaskRunner(s);
    const first = deferred<string>();
    const second = deferred<string>();
    const received: string[] = [];
    const firstRun = runner.run(
      "reconstruct",
      () => first.promise,
      (value) => received.push(value),
      () => received.push("old error"),
    );
    runner.cancel();
    const secondRun = runner.run(
      "reconstruct",
      () => second.promise,
      (value) => received.push(value),
      () => received.push("new error"),
    );
    first.resolve("old");
    await firstRun;
    assert.equal(s.getSnapshot().task?.id, 2);
    second.resolve("new");
    await secondRun;
    assert.deepEqual(received, ["new"]);
    const rejected = deferred<string>();
    const third = runner.run(
      "region",
      () => rejected.promise,
      (value) => received.push(value),
      () => received.push("cancelled error"),
    );
    runner.cancel();
    rejected.reject(new Error("late"));
    await third;
    assert.deepEqual(received, ["new"]);
  });
});
