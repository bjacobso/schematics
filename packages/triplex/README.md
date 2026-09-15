# @schematics/triplex

The Schematics-owned adapter between source declarations/providers and Triplex.
It publishes a sorted set of source files as one immutable, content-addressed
configuration snapshot and records provider observations in transactions whose
`configSnapshot` metadata pins the exact declaration release they observed.

`layer` requires Triplex `Triples` and `ConfigStore` services, so server hosts can
provide a durable Triplex backend. `memoryLayer(scope)` is the browser/test layer
used by the standalone Foldkit workbench.
