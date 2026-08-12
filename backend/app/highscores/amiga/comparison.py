from collections import Counter


def find_new_scores(current_rows: list[dict], baseline_rows: list[dict]) -> list[dict]:
    """Return genuine new name/score combinations without comparing table ranks."""
    baseline = Counter((row["name"], row["score"]) for row in baseline_rows)
    detected = []
    for row in current_rows:
        identity = (row["name"], row["score"])
        if baseline[identity]:
            baseline[identity] -= 1
        elif row["score"] > 0:
            detected.append({"name": row["name"], "score": row["score"]})
    return sorted(detected, key=lambda row: row["score"], reverse=True)
