from __future__ import annotations

import threading

from backend.app import database, worker


def test_worker_picks_up_pending_and_new_tasks(monkeypatch, tmp_path):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "worker.sqlite")
    database.init_db()
    pre_queued = [
        database.create_task(f"https://www.youtube.com/watch?v=v{i:011d}") for i in range(2)
    ]

    executed: list[str] = []
    target = len(pre_queued) + 1
    done = threading.Event()

    def runner(task_id: str) -> None:
        executed.append(task_id)
        if len(executed) == target:
            done.set()

    monkeypatch.setattr(worker, "_thread", None)
    worker.start(runner)
    worker.enqueue("late-task")

    assert done.wait(timeout=2.0)
    assert executed[:2] == pre_queued
    assert executed[-1] == "late-task"
