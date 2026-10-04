# open

Small, runnable software projects with visible internals. Build an understanding of the program by following its execution and reading the source alongside it.

## Start here: Structure Workshop

Five Java experiments share a simple 90s desktop interface: **Pair Playground, Array Observatory, Link Workshop, Branch Explorer, and Dependency Workshop**. Edit the initial values and instructions, then use **Play, Next, Back, and Reset** to follow the program. **Show code** opens the actual Java source beside the visualization and highlights the line behind each recorded step.

Clone the whole repository: Structure Workshop reuses Array Observatory's Java engine from its sibling directory.

```sh
git clone https://github.com/elgatito3131/open.git
cd open/projects/structure-workshop
./test.sh
./run.sh
```

Requires a JDK supporting Java 17 or later and a POSIX shell. Open <http://127.0.0.1:4197/?lab=link> after starting the server. No downloaded Java dependencies are required. Java produces immutable execution snapshots; the browser draws and replays them.

| Project | Core language | Status |
| --- | --- | --- |
| [Structure Workshop](projects/structure-workshop/README.md) | Java | Runnable; five labs covering generics, arrays, linked lists, trees, hashing, graphs, and heaps |
| [Array Observatory](projects/array-observatory/README.md) | Java | Original standalone array experiment, preserved on port 4196 |

The labs cover concepts associated with a P0–P4 data-structures sequence. They are independent implementations and examples, not complete school assignments. The workshop documentation identifies which structures are custom and which use Java's standard library.

![Structure Workshop](projects/structure-workshop/docs/preview.png)

The original Array Observatory interface remains available in its own project directory.

The [roadmap](docs/roadmap.md) describes future work. Planned projects are not completed implementations.

## What belongs here

Original implementations, invented examples, tests, source explanations, and demonstrations. This is an AI-assisted learning and portfolio collection. The source and documentation identify the current scope and limitations.

Original coursework, instructor scaffolds, assignment specifications, private study archives, personal records, and confidential business material are excluded. A visual redesign is not permission to redistribute an assignment solution.

## Checks

The GitHub workflow compiles and checks both Java projects with Java 17 and 21. Run the same project checks locally with `./test.sh` inside each project directory. Checks include algorithm behavior, invariants, immutable snapshots, source references, and generic type safety. A successful new implementation does not establish historical deployment, customer, institutional, or contribution claims.

## License

MIT; see [LICENSE](LICENSE).
