# Project roadmap

Build one complete, explainable project at a time. Each release needs a working demonstration, reproducible startup, meaningful checks, and source connected to visible execution. Keep the interface simple; expose detail when requested.

## Available

- **[Data Structures Workshop](../projects/structure-workshop/README.md) — Java:** five runnable labs, each with editable inputs, step descriptions, Play/Next/Back/Reset, and Java source alongside recorded execution.

| Lab | Implemented concepts |
| --- | --- |
| Generic Pair | Generic `Pair<T>`, references, replacements, empty values, and swaps |
| Array List | Custom dynamic array, doubling growth, indexed edits, copies, and shifts; reuses the standalone engine |
| Doubly Linked List | Custom doubly linked nodes, standard-library map lookup, and a standard-library undo stack |
| Tree & Hash Table | First-child / next-sibling tree, a fixed linear-probing index, tombstones, preorder, and level order |
| Topological Sort | Directed graph, custom indexed min-heap, topological ordering, and cycle-blocked states |

These are independent labs covering the P0–P4 concept sequence, not completed school assignments. They do not cover every requirement of those assignments.

- **[Array Observatory](../projects/array-observatory/README.md) — Java:** the original standalone application remains available, with growth policies, trace costs, and source navigation.

## Product applications

Dwello and Frontier now have original local implementations:

- **[Dwello](../projects/dwello/README.md):** React, Node/Express, PostgreSQL. A fictional property ledger with atomic tenant/lease creation, receipt recording, database constraints, and request/source playback. Authentication, payment processing, and deployment remain future work.
- **[Frontier](../projects/frontier/README.md):** Next.js, Python/FastAPI, PostgreSQL and pgvector. Twelve fictional lab profiles, keyword and MiniLM semantic search, filters, profiles, and retrieval/source playback. Local PostgreSQL is the tested database; Supabase cloud services, ingestion, and production authorization remain future work.

## Planned

| Area | Language or stack | Demonstration |
| --- | --- | --- |
| Further data structures and algorithms | Java | Compression, algorithm comparisons, and extensions beyond the five available labs |
| Systems | C, Unix | Scheduling, configurable floating-point formats, processes, signals, and pipes |
| Reliable transport | Python, UDP | Sequence numbers, acknowledgments, loss, corruption, reordering, and retransmission |
| Concurrency and operating systems | C; OS/161 where applicable | Locks, wait states, process lifecycle, and clearly distinguished simulations versus kernel work |
| Databases | Oracle SQL, Java JDBC, MongoDB | A fictional domain with schemas, imports, queries, and data-flow views |
| Local cryptography and PKI lab | Stack to confirm; Java for recovered TLS activity | Signing, verification, certificate chains, and local HTTPS |
| Atlas / Project Studio public edition | HTML, CSS, JavaScript; local Python host | Portable learning tools, public source pointers, and new examples |
| Dwello extensions | React, Node.js, PostgreSQL, REST | Tenant reuse and renewals, additional ledger operations, authentication |
| Frontier extensions | Next.js, Python, Supabase/PostgreSQL, embeddings, pgvector | Real public source ingestion, larger retrieval evaluation, deployment |
| Document retrieval | Python, FastAPI, Hugging Face, FAISS, Llama 2 | Ingestion, retrieval, citations, and evaluation |
| Contextual help overlay | Electron, React, TypeScript, macOS Accessibility APIs | A bounded application walkthrough from UI structure to guidance |

Recover source and ownership evidence before reusing existing product or team work. Unidentified hackathon work and previous open-source contributions need their original repositories and contribution links before a rebuild or portfolio description is defined.

For projects inspired by coursework, retain general concepts and create new requirements, APIs, examples, tests, and interfaces. Do not publish the original course solutions, frameworks, or teaching materials. Do not describe new demonstrations as proof of past work.
