"""Only these public project files are readable through the learning view."""
import inspect
from .config import ROOT

ALLOWED = {
    "api/main.py", "api/search.py", "api/database.py", "api/embeddings.py",
    "api/seed.py", "api/schema.sql", "data/labs.json", "data/evaluation.json",
}


def source_file(file: str) -> dict:
    if file not in ALLOWED:
        raise KeyError(file)
    return {"file": file, "language": "python" if file.endswith(".py") else
            "sql" if file.endswith(".sql") else "json", "source": (ROOT / file).read_text()}


def trace_step(number: int, title: str, description: str, function) -> dict:
    """Use the function's actual current file and line range, not guessed locations."""
    lines, start = inspect.getsourcelines(function)
    file = str(inspect.getsourcefile(function))
    relative = str(__import__("pathlib").Path(file).relative_to(ROOT))
    if relative not in ALLOWED:
        raise ValueError("Trace target is not part of the public source allowlist.")
    return {"step": number, "title": title, "description": description, "file": relative,
            "lineStart": start, "lineEnd": start + len(lines) - 1,
            "snippet": "".join(lines)}
