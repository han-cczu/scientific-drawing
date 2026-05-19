# Evaluation Suite

Put stable evaluation images in this directory and register them in `manifest.json`.

Each sample should include:

- `file`: image file name under this directory.
- `category`: one of `paper_figure`, `flowchart`, `table`, `module`.
- `expectedNodes`: expected approximate editable node count.
- `expectedEdges`: expected approximate semantic edge count.

Runtime uploads under `data/uploads` are not a stable benchmark.
