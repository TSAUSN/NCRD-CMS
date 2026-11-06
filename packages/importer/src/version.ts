/**
 * The version of the mapping this package performs.
 *
 * Part of the run ID, alongside the hash of the inputs, and that pairing is the
 * whole point: the same V1 catalogue read by two different importers is two
 * different results, and a run ID that only covered the inputs would give both
 * of them the same name. Bump this whenever a definition could change status or
 * shape — a new reason code, a widened mapping, a corrected refusal — because a
 * reader comparing two runs has nothing else to tell them apart.
 */
export const IMPORTER_VERSION = 4
