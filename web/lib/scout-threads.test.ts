import { describe, expect, it } from "vitest";
import { openThread, readStore, startThread, storable, threadTitle, updateThread, type ScoutStore } from "./scout-threads";

const ids = () => {
  let n = 0;
  return () => `t${(n += 1)}`;
};
const topic = { key: "task:price", title: "Set the price", context: "Price task" };
const say = (store: ScoutStore, id: string, text: string, now: number) =>
  updateThread(store, id, (thread) => ({ ...thread, messages: [...thread.messages, { role: "user", text }], updatedAt: now }));

describe("scout threads", () => {
  it("moves the old single chat into a general thread", () => {
    const legacy = JSON.stringify({ messages: [{ role: "user", text: "Hola" }], previousId: "resp_1", documents: null });
    const store = readStore(null, legacy, 1);
    expect(store.threads).toHaveLength(1);
    expect(store.threads[0]).toMatchObject({ topic: null, previousId: "resp_1" });
    expect(store.activeId).toBe(store.threads[0].id);
    expect(readStore("not json", null, 1)).toEqual({ threads: [], activeId: null });
  });

  it("resumes the thread for a topic instead of starting another", () => {
    const newId = ids();
    const opened = openThread({ threads: [], activeId: null }, topic, newId, 1);
    const thread = opened.thread;
    let store = say(opened.store, thread.id, "What discount?", 2);
    ({ store } = openThread(store, null, newId, 3));
    expect(store.threads).toHaveLength(2);
    const again = openThread(store, topic, newId, 4);
    expect(again.thread.id).toBe(thread.id);
    expect(again.store.activeId).toBe(thread.id);
  });

  it("starts a new thread on the same topic, and drops empty ones", () => {
    const newId = ids();
    const opened = openThread({ threads: [], activeId: null }, topic, newId, 1);
    let store = say(opened.store, opened.thread.id, "First", 2);
    ({ store } = startThread(store, topic, newId, 3));
    ({ store } = startThread(store, topic, newId, 4)); // the empty one in between is dropped
    expect(store.threads.map((item) => item.id)).toEqual(["t1", "t3"]);
    // Re-opening the topic finds the newest thread on it, even if empty.
    expect(openThread(store, topic, newId, 5).thread.id).toBe("t3");
    expect(storable(store)).toEqual({ threads: [store.threads[0]], activeId: null });
  });

  it("titles general threads by their first question", () => {
    const newId = ids();
    const opened = openThread({ threads: [], activeId: null }, null, newId, 1);
    expect(threadTitle(opened.thread)).toBe("General chat");
    const store = say(opened.store, opened.thread.id, "What goes in each envelope, and in what format do they want it?", 2);
    expect(threadTitle(store.threads[0])).toBe("What goes in each envelope, and in what format…");
  });
});
